// Vite が出したファイルを列挙して、公開用の Service Worker の先読み一覧と版を作る。
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_PLACEHOLDER = "const CACHE_NAME = 'money-app-dev';";
const ASSETS_PATTERN = /const ASSETS = \[[\s\S]*?\];/g;

async function filesUnder(root, dir = root) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, path));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'));
    else throw new Error(`公開する場所に通常のファイル以外があります: ${path}`);
  }
  return files.sort();
}

export async function finalizeServiceWorker(outDir) {
  const root = resolve(outDir);
  const swPath = join(root, 'sw.js');
  const template = await readFile(swPath, 'utf8');
  if (template.split(CACHE_PLACEHOLDER).length !== 2) throw new Error('sw.js の版の差し込み場所が1つではありません');
  const assetBlocks = [...template.matchAll(ASSETS_PATTERN)];
  if (assetBlocks.length !== 1) throw new Error('sw.js の ASSETS が1つではありません');

  // ソースマップ（.map）は開発者ツールが必要なときだけ読む。先読みはしない
  const files = (await filesUnder(root)).filter(path => path !== 'sw.js' && !path.endsWith('.map'));
  const available = new Set(files);
  if (!available.has('index.html')) throw new Error('公開する index.html がありません');
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const moduleRefs = [...html.matchAll(/<script\s+[^>]*type="module"[^>]*src="([^"]+)"/g)].map(match => match[1]);
  if (!moduleRefs.length) throw new Error('index.html にアプリのモジュールがありません');
  const localRefs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map(match => match[1])
    .filter(url => !/^(?:https?:|data:|#)/.test(url))
    .map(url => url.replace(/^\.\//, '').split(/[?#]/, 1)[0]);
  for (const file of localRefs) {
    if (!available.has(file)) throw new Error(`index.html が読む ${file} が公開するファイルにありません`);
  }

  const oldAssets = assetBlocks[0][0];
  const external = [...oldAssets.matchAll(/['"](https?:\/\/[^'"]+)['"]/g)].map(match => match[1]);
  const required = [...oldAssets.matchAll(/['"]\.\/([^'"]+)['"]/g)].map(match => match[1]).filter(Boolean);
  for (const file of required) {
    if (!available.has(file)) throw new Error(`sw.js の ASSETS にある ${file} が公開するファイルにありません`);
  }
  const assetUrls = ['./', ...files.map(file => `./${file}`), ...external];
  const manifest = `const ASSETS = ${JSON.stringify(assetUrls, null, 2)};`;

  // 名前・中身・Service Worker の元を含める。同じ成果物なら同じ版になる。
  const hash = createHash('sha256');
  hash.update(template);
  for (const file of files) {
    const bytes = await readFile(join(root, file));
    hash.update(`\0${file}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  const version = `money-app-${hash.digest('hex').slice(0, 12)}`;
  const output = template.replace(oldAssets, manifest).replace(CACHE_PLACEHOLDER, `const CACHE_NAME = '${version}';`);
  await writeFile(swPath, output);
  return { version, assets: assetUrls };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { version } = await finalizeServiceWorker(process.argv[2] || '_site');
    process.stdout.write(`${version}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
