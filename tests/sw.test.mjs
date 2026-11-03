// Service Worker（sw.js）と公開の決まり（D15・D4 手順6）のテスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeServiceWorker } from '../scripts/finalize-sw.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sw = read('sw.js');
const html = read('index.html');
// ソースの ASSETS は、開発サーバーで先読みする固定ファイルだけ。
const assets = [...sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean);

test('CACHE_NAME は、リポジトリでは money-app-dev のまま（公開するときに中身の指紋に置き換える）', () => {
  assert.match(sw, /const CACHE_NAME = 'money-app-dev';/);
  assert.equal(sw.split("'money-app-dev'").length - 1, 1, "'money-app-dev' は1か所だけ（2か所あると両方置き換わる）");
});

test('開発用 ASSETS のファイルは存在する', () => {
  for (const f of assets) assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), `${f} がありません`);
});

test('Vite は生成物に指紋を付ける', () => {
  assert.deepEqual(assets.filter(f => f.startsWith('assets/')), []);
  assert.match(read('vite.config.mjs'), /entryFileNames: 'assets\/\[name\]-\[hash\]\.js'/);
  assert.match(read('vite.config.mjs'), /chunkFileNames: 'assets\/\[name\]-\[hash\]\.js'/);
});

test('開発用の index.html が読む CSS と manifest.json は ASSETS にある', () => {
  const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]);
  const styles = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts, []);
  assert.ok(styles.length > 0);
  for (const f of [...scripts, ...styles, 'manifest.json', 'index.html']) assert.ok(assets.includes(f), `${f} が sw.js の ASSETS にありません`);
});

test('モジュールの入口は1つ（src/main.ts）で、ファイルがある', () => {
  const modules = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(modules, ['src/main.ts']);
  assert.ok(existsSync(new URL('../src/main.ts', import.meta.url)));
});

async function fixture(t, moduleText = 'app') {
  const dir = await mkdtemp(join(tmpdir(), 'maney-sw-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'assets'));
  await mkdir(join(dir, 'css'));
  await writeFile(join(dir, 'sw.js'), sw);
  await writeFile(join(dir, 'index.html'), '<link rel="stylesheet" href="css/app.css"><script type="module" src="./assets/index-abc.js"></script>');
  await writeFile(join(dir, 'css/app.css'), 'body{}');
  await writeFile(join(dir, 'manifest.json'), '{}');
  await writeFile(join(dir, 'icon-192.png'), 'icon');
  await writeFile(join(dir, 'assets/index-abc.js'), moduleText);
  await writeFile(join(dir, 'assets/chunk-def.js'), 'chunk');
  return dir;
}

test('ビルドした全ファイルを先読みし、同じ中身なら同じ版にする', async t => {
  const first = await fixture(t);
  const second = await fixture(t);
  const a = await finalizeServiceWorker(first);
  const b = await finalizeServiceWorker(second);
  assert.equal(a.version, b.version);
  assert.deepEqual(a.assets.filter(url => url.startsWith('./assets/')), ['./assets/chunk-def.js', './assets/index-abc.js']);
  assert.ok(a.assets.includes('./css/app.css'));
  assert.ok(a.assets.includes('./icon-192.png'));
  assert.ok(a.assets.includes('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'));
  const output = await readFile(join(first, 'sw.js'), 'utf8');
  assert.match(output, new RegExp(`const CACHE_NAME = '${a.version}'`));
  assert.match(output, /"\.\/assets\/index-abc\.js"/);
  assert.doesNotMatch(output, /const CACHE_NAME = 'money-app-dev'/);
});

test('公開ファイルの内容が変わると版も変わる', async t => {
  const first = await fixture(t);
  const second = await fixture(t, 'changed app');
  assert.notEqual((await finalizeServiceWorker(first)).version, (await finalizeServiceWorker(second)).version);
});

test('Service Worker の中身が変わると版も変わる', async t => {
  const first = await fixture(t);
  const second = await fixture(t);
  await writeFile(join(second, 'sw.js'), `${sw}\n// 変更`);
  assert.notEqual((await finalizeServiceWorker(first)).version, (await finalizeServiceWorker(second)).version);
});

test('index.html が参照するファイルが足りなければ公開を止める', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'index.html'), '<script type="module" src="./assets/missing.js"></script>');
  await assert.rejects(finalizeServiceWorker(dir), /assets\/missing\.js が公開するファイルにありません/);
});

test('旧 js/ の script は HTML に残っていない', () => {
  assert.doesNotMatch(html, /<script src="js\//);
});
