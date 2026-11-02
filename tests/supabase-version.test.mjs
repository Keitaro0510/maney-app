// index.html が CDN から読む Supabase のライブラリの版と、型のために入れた開発用の依存の版を、同じに保つ（D19）。
// 版を上げるときは、index.html の URL と package.json（npm install --save-exact @supabase/supabase-js@x.y.z）の両方を直す。
// CDN の指定が @2 のような範囲だと、ある日そのまま本番に新しい版が入るので、正確な版だけを許す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('CDN の Supabase の版は、正確な x.y.z で、package.json の開発用の依存と同じ', () => {
  const m = read('index.html').match(/@supabase\/supabase-js@([^/"]+)/);
  assert.ok(m, 'index.html に @supabase/supabase-js の読み込みがありません');
  assert.match(m[1], /^\d+\.\d+\.\d+$/, `版が固定されていません: ${m[1]}`);
  const dep = JSON.parse(read('package.json')).devDependencies['@supabase/supabase-js'];
  assert.equal(dep, m[1], 'package.json の版が index.html と違います（^ や ~ を付けず、同じ版にする）');
});
