// ローカルの Supabase で、MCP のツール（予定・タスクの追加・変更・削除）を、OAuth のトークンで実際に呼んで確かめる（Issue #190・D37）。
// 実行: node scripts/check-mcp-tools.mjs   （準備は docs/MCP.md。ローカル専用で、本番には向けない）
// テストユーザー mcp-spike@example.com（docs/MCP.md の手順で作る）の、ローカルの DB だけに書く。終わりに、作ったものを片付ける。
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const API = 'http://127.0.0.1:54321';
const KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const REDIRECT = 'http://127.0.0.1:6274/callback';
const b64url = buf => Buffer.from(buf).toString('base64url');

// ---- OAuth でトークンを取る（scripts/check-mcp-oauth.mjs と同じ流れ。同意画面の代わりに承認） ----
const supa = createClient(API, KEY, { auth: { persistSession: false } });
const { error: loginErr } = await supa.auth.signInWithPassword({ email: 'mcp-spike@example.com', password: 'spike-password-123' });
if (loginErr) throw loginErr;
const reg = await (await fetch(`${API}/auth/v1/oauth/clients/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_name: 'check-mcp-tools', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
})).json();
const verifier = b64url(randomBytes(32));
const authRes = await fetch(`${API}/auth/v1/oauth/authorize?` + new URLSearchParams({
  response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, scope: 'openid email', state: 's',
  code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
}), { redirect: 'manual' });
const authorizationId = new URL(authRes.headers.get('location')).searchParams.get('authorization_id');
await supa.auth.oauth.getAuthorizationDetails(authorizationId); // 同意画面が最初にやること（これを呼ばないと、承認が「not found」になる）
const { data: approved } = await supa.auth.oauth.approveAuthorization(authorizationId);
const tok = await (await fetch(`${API}/auth/v1/oauth/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', code: new URL(approved.redirect_url).searchParams.get('code'), redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier }),
})).json();
assert.ok(tok.access_token, 'トークンが取れません');
console.log('OAuth のトークンを取りました\n');

// ---- MCP のツールを呼ぶ ----
let nextId = 1;
async function rpc(method, params) {
  const r = await fetch(`${API}/functions/v1/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${tok.access_token}` },
    body: Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }), 'utf8'),
  });
  const body = await r.text();
  const line = body.split('\n').find(l => l.startsWith('data:'));
  return { status: r.status, json: line ? JSON.parse(line.slice(5)) : null, raw: body };
}
async function call(name, args = {}) {
  const { json, status, raw } = await rpc('tools/call', { name, arguments: args });
  if (!json) throw new Error(`${name}: 応答が読めません（${status}）${raw.slice(0, 200)}`);
  if (json.error) return { error: true, text: JSON.stringify(json.error) };
  const text = json.result.content.map(c => c.text).join('\n');
  return { error: !!json.result.isError, text };
}
const idOf = text => (text.match(/"id": "([0-9a-f-]{36})"/) || [])[1];
const step = (title, r) => console.log(`■ ${title}\n  ${r.error ? '【エラー】' : ''}${r.text.replace(/\n/g, '\n  ')}\n`);

const created = { plans: [], tasks: [], shifts: [], jobs: [] };
try {
  const tools = await rpc('tools/list', {});
  console.log('ツール:', tools.json.result.tools.map(t => t.name).join('、'), '\n');

  // 準備: カードを1枚（アプリと同じ apply_op で）
  const { data: card } = await supa.from('cards').select('id,name').is('deleted_at', null).limit(1);
  let cardName = card?.[0]?.name;
  if (!cardName) {
    const { data, error } = await supa.rpc('apply_op', { op: { id: crypto.randomUUID(), epoch: 1, changes: [{ table: 'cards', action: 'insert', id: crypto.randomUUID(), row: { name: '検証カード', close_day: 15, bill_day: 10, position: 0 } }] } });
    assert.equal(error, null); assert.equal(data.status, 'applied');
    cardName = '検証カード';
    created.card = data.rows[0].id;
  }
  step('list_cards', await call('list_cards'));

  // ---- シフト（読むだけ）。アプリと同じ apply_op で、バイト先とシフトを作ってから、読めるか確かめる ----
  const jobId = crypto.randomUUID(), job2Id = crypto.randomUUID(), shiftId = crypto.randomUUID(), nightId = crypto.randomUUID();
  const jobName = `検証カフェ${Date.now() % 10000}`, job2Name = `検証居酒屋${Date.now() % 10000}`;
  const mk = await supa.rpc('apply_op', { op: { id: crypto.randomUUID(), epoch: 1, changes: [
    { table: 'jobs', action: 'insert', id: jobId, row: { name: jobName, color: 'blue', wage: 1200, position: 0 } },
    { table: 'jobs', action: 'insert', id: job2Id, row: { name: job2Name, color: 'green', wage: 1500, position: 1 } },
    { table: 'shifts', action: 'insert', id: shiftId, row: { date: '2026-12-15', job_id: jobId, start_time: '17:00', end_time: '22:00', wage: 1200, rest_minutes: 30, position: 0 } },
    { table: 'shifts', action: 'insert', id: nightId, row: { date: '2026-12-16', job_id: jobId, start_time: '22:00', end_time: '05:00', wage: 1200, rest_minutes: 0, position: 1 } },
  ] } });
  assert.equal(mk.data?.status, 'applied', JSON.stringify(mk));
  created.jobs.push(jobId, job2Id); created.shifts.push(shiftId, nightId);
  const shifts = await call('list_shifts', { from: '2026-12-15', to: '2026-12-16' });
  step('list_shifts（日をまたぐシフトも・時給は出ない）', shifts);
  assert.match(shifts.text, /実働4.5時間/);
  assert.match(shifts.text, /"overnight": true/);
  assert.doesNotMatch(shifts.text, /1200|wage/);

  // ---- シフトの追加・変更・削除 ----
  const jobs = await call('list_jobs');
  step('list_jobs（時給は出ない）', jobs);
  assert.match(jobs.text, new RegExp(jobName)); assert.doesNotMatch(jobs.text, /1200|1500|wage/);
  const sadd = await call('add_shift', { job: jobName.slice(0, 6), date: '2026-12-18', start_time: '09:00', end_time: '13:00', rest_minutes: 30 });
  step('add_shift（バイト先は名前の一部）', sadd);
  assert.ok(!sadd.error, sadd.text);
  const newShiftId = idOf(sadd.text); created.shifts.push(newShiftId);
  const { data: srow } = await supa.from('shifts').select('*').eq('id', newShiftId).single();
  assert.equal(srow.wage, 1200); assert.equal(srow.rest_minutes, 30); assert.equal(srow.start_time, '09:00:00'); // 時給は、バイト先の時給のコピー
  step('add_shift（同じシフト → 入れずに知らせる）', await call('add_shift', { job: jobName, date: '2026-12-18', start_time: '09:00', end_time: '13:00' }));
  const overnight = await call('add_shift', { job: jobName, date: '2026-12-19', start_time: '22:00', end_time: '05:00' });
  step('add_shift（日をまたぐ → 誤り）', overnight);
  assert.ok(overnight.error); assert.match(overnight.text, /出勤より後/);
  step('add_shift（バイト先がない → 誤り）', await call('add_shift', { job: 'ないバイト先', date: '2026-12-19', start_time: '09:00', end_time: '13:00' }));
  step('add_shift（休憩が長い → 誤り）', await call('add_shift', { job: jobName, date: '2026-12-19', start_time: '09:00', end_time: '10:00', rest_minutes: 60 }));
  step('update_shift（時間と休憩を変える）', await call('update_shift', { id: newShiftId, start_time: '10:00', end_time: '14:00', rest_minutes: 0 }));
  const { data: srow2 } = await supa.from('shifts').select('start_time,end_time,rest_minutes,wage').eq('id', newShiftId).single();
  assert.deepEqual([srow2.start_time, srow2.end_time, srow2.rest_minutes, srow2.wage], ['10:00:00', '14:00:00', 0, 1200]);
  step('update_shift（バイト先を変える → 時給も変わる）', await call('update_shift', { id: newShiftId, job: job2Name }));
  const { data: srow3 } = await supa.from('shifts').select('job_id,wage').eq('id', newShiftId).single();
  assert.deepEqual([srow3.job_id, srow3.wage], [job2Id, 1500]);
  step('update_shift（日付を変える）', await call('update_shift', { id: newShiftId, date: '2026-12-21' }));
  step('update_shift（終わりを開始より前に → 誤り）', await call('update_shift', { id: newShiftId, end_time: '09:00' }));
  step('delete_shift', await call('delete_shift', { id: newShiftId }));
  created.shifts = created.shifts.filter(x => x !== newShiftId);
  step('delete_shift（もう無い）', await call('delete_shift', { id: newShiftId }));

  // ---- 予定 ----
  const title = `検証の飲み会 ${Date.now() % 100000}`;
  const add = await call('add_plan', { title, start_date: '2026-12-20', start_time: '19:00', end_time: '21:00', budget: 4000, payment: 'card', card: cardName.slice(0, 2) });
  step('add_plan（カード払い・名前の一部）', add);
  assert.ok(!add.error, add.text);
  const planId = idOf(add.text); created.plans.push(planId);

  const dup = await call('add_plan', { title, start_date: '2026-12-20' });
  step('add_plan（同じ予定 → 入れずに知らせる）', dup);
  assert.match(dup.text, /すでにあるので、入れませんでした/);

  step('add_plan（カード名が違う → 誤り）', await call('add_plan', { title: '誤り', start_date: '2026-12-21', payment: 'card', card: 'ないカード' }));
  step('add_plan（実在しない日付 → 誤り）', await call('add_plan', { title: '誤り', start_date: '2026-02-30' }));

  const moved = await call('update_plan', { id: planId, start_date: '2026-12-22' });
  step('update_plan（日付を変える）', moved);
  assert.match(moved.text, /2026-12-22/);
  step('update_plan（現金にする・時間を消す）', await call('update_plan', { id: planId, payment: 'cash', start_time: null }));
  step('update_plan（済みにする）', await call('update_plan', { id: planId, done: true }));
  const listed = await call('list_plans', { from: '2026-12-01', to: '2026-12-31', query: '検証の飲み会' });
  step('list_plans', listed);
  assert.match(listed.text, /"done": true/);
  assert.match(listed.text, /"start_date": "2026-12-22"/);

  // ---- タスク ----
  const ttitle = `検証のレポート ${Date.now() % 100000}`;
  const tadd = await call('add_task', { title: ttitle, due_date: '2026-12-25', tags: ['検証'] });
  step('add_task', tadd);
  const taskId = idOf(tadd.text); created.tasks.push(taskId);
  step('add_task（同じタスク）', await call('add_task', { title: ttitle, due_date: '2026-12-25' }));
  step('update_task（期限を変える）', await call('update_task', { id: taskId, due_date: '2026-12-28' }));
  step('update_task（期限を消す）', await call('update_task', { id: taskId, due_date: null }));
  step('complete_task（済み）', await call('complete_task', { id: taskId }));
  step('complete_task（もう一度 → すでに済み）', await call('complete_task', { id: taskId }));
  step('list_tasks（済みも）', await call('list_tasks', { include_done: true, query: '検証のレポート' }));
  step('complete_task（未完了に戻す）', await call('complete_task', { id: taskId, done: false }));

  // ---- アプリから見える形か（直接 DB を読む。アプリは同じ行を読む） ----
  const { data: planRow } = await supa.from('plans').select('*').eq('id', planId).single();
  assert.equal(planRow.start_date, '2026-12-22'); assert.equal(planRow.done, true); assert.equal(planRow.card_id, null); assert.equal(planRow.start_time, null);
  assert.equal(planRow.color, 'pink');
  const { data: taskRow } = await supa.from('tasks').select('*').eq('id', taskId).single();
  assert.equal(taskRow.due_date, null); assert.equal(taskRow.completed_at, null); assert.deepEqual(taskRow.tags, ['検証']);
  console.log('■ DB の行は、アプリが読む形（色 pink・位置・タグ・時刻）になっている\n');

  // ---- 別の端末（アプリ）が先に変えた → 競合 ----
  // MCP が読んだあとに、アプリが変えた場面を作る: update_plan の中で base を使うので、先に別の更新を入れて、古い updated_at を狙うのは難しい。
  // ここでは、アプリ側（apply_op）で先に変えたあとの update_plan が、最新の行を読んで成功することを確かめる。
  const { data: r } = await supa.rpc('apply_op', { op: { id: crypto.randomUUID(), epoch: 1, changes: [{ table: 'plans', action: 'update', id: planId, base: planRow.updated_at, row: { memo: 'アプリで書いたメモ' } }] } });
  assert.equal(r.status, 'applied');
  const after = await call('update_plan', { id: planId, budget: 5000 });
  step('update_plan（アプリが先に変えたあと）', after);
  assert.ok(!after.error, after.text);
  const { data: planRow2 } = await supa.from('plans').select('memo,budget').eq('id', planId).single();
  assert.equal(planRow2.memo, 'アプリで書いたメモ'); assert.equal(planRow2.budget, 5000); // 互いの変更が消えていない

  // ---- 削除 ----
  step('delete_plan', await call('delete_plan', { id: planId }));
  created.plans = [];
  step('delete_plan（もう無い）', await call('delete_plan', { id: planId }));
  step('delete_task', await call('delete_task', { id: taskId }));
  created.tasks = [];
  const { data: gone } = await supa.from('plans').select('id').eq('id', planId);
  assert.equal(gone.length, 0);
  // 履歴に残っている（戻せる）
  const { data: hist } = await supa.rpc('apply_op', { op: { id: crypto.randomUUID(), epoch: 1, changes: [{ table: 'plans', action: 'delete', id: planId, base: '2000-01-01T00:00:00Z' }] } });
  assert.equal(hist.status, 'applied'); // すでに消えた行を消すのは成功
  console.log('すべて確かめました');
} finally {
  // 片付け（途中で止まったときも）
  for (const id of created.plans) await supa.from('plans').delete().eq('id', id);
  for (const id of created.tasks) await supa.from('tasks').delete().eq('id', id);
  for (const id of created.shifts) await supa.from('shifts').delete().eq('id', id);
  for (const id of created.jobs) await supa.from('jobs').delete().eq('id', id);
  if (created.card) await supa.from('cards').delete().eq('id', created.card);
}
