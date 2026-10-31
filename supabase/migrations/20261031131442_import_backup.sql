-- 手順8の段5（D13）: 書き出した JSON のファイルで、ユーザーのデータを全部置き換える（インポート）。
-- 書き出し（エクスポート）はアプリだけで作る（読み込んである行をファイルにする）。DB は読み込みだけを受け持つ。
--
-- apply_op は1回に500件までなので、全部を1つのトランザクションで置き換える関数を別に作る。
-- - 中身を確かめてから書く。どこかで失敗したら、全部を取り消す（半端な状態を残さない）
-- - 書く前に、今の状態を写し（before_import）に残す。private.restore_snapshot で戻せる
-- - ファイルの user_id・created_at・updated_at は使わない。ログインしている人の ID と、サーバーの時刻にする
-- - データが入れ替わるので epoch を上げる。ほかの端末の送れていない変更は、保存する前に止まる

-- ============================================================
-- 写しの種類に「読み込む直前」（before_import）を足す
-- ============================================================
alter table private.snapshots drop constraint snapshots_reason_check;
alter table private.snapshots add constraint snapshots_reason_check
  check (reason in ('daily', 'cutover', 'before_restore', 'before_import', 'manual'));

-- 毎日の写し・戻す直前の写しと同じく、読み込む直前の写しも90日で消す。切り替えのときと、手で取った写しは残す
select cron.schedule(
  'purge-snapshots',
  '30 18 * * *',
  $$delete from private.snapshots where reason in ('daily', 'before_restore', 'before_import') and taken_at < now() - interval '90 days'$$
);

-- ============================================================
-- 読み込むテーブル
-- ============================================================

-- 写しのテーブルから、もう使わない fixed_incomes を除いたもの（参照される側が先）。アプリの MoneyData.TABLES と同じ。
-- テーブルを足すときは private.snapshot_tables() に足せば、ここにも入る
create function private.import_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array_agg(u.name order by u.ord)
  from unnest(private.snapshot_tables()) with ordinality as u(name, ord)
  where u.name <> 'fixed_incomes'
$$;

-- ============================================================
-- 読み込む
-- ============================================================

-- ファイル: { "format": "maney-export", "version": 1, "exported_at": "...", "tables": { "settings": [行], … } }
-- 返す値: { "status": "imported", "snapshot_id": 読み込む直前の写しの id, "epoch": 新しい移行の番号, "counts": { テーブル: 件数 } }
-- 写し（private スキーマ）に書くので security definer にする。RLS を通らないので、ログインしている人の行だけを消し、
-- 入れる行の user_id はログインしている人にする。カード・バイト先・カテゴリへの参照は (user_id, id) なので、他人の行は指せない
create function public.import_backup(p_file jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- サーバーが決める列。ファイルにあっても使わない（id はつながりのために使う）
  server_columns constant text[] := array['user_id', 'created_at', 'updated_at'];

  v_uid uuid := auth.uid();
  v_tables text[] := private.import_tables();
  v_data jsonb;
  t text;
  v_row jsonb;
  v_index bigint;
  v_bad text;
  v_columns text;
  v_counts jsonb := '{}'::jsonb;
  v_snapshot bigint;
  v_epoch integer;
  v_constraint text;
begin
  if v_uid is null then
    raise exception 'ログインしていません' using errcode = '42501';
  end if;

  -- ---------- ファイルの形を確かめる（まだ何も書かない） ----------
  if jsonb_typeof(p_file) is distinct from 'object' or p_file ->> 'format' is distinct from 'maney-export' then
    raise exception 'このアプリが書き出したファイルではありません' using errcode = '22023';
  end if;
  if jsonb_typeof(p_file -> 'version') is distinct from 'number' or p_file ->> 'version' <> '1' then
    raise exception 'ファイルの版（%）は読み込めません', p_file -> 'version' using errcode = '22023';
  end if;
  v_data := p_file -> 'tables';
  if jsonb_typeof(v_data) is distinct from 'object' then
    raise exception 'ファイルに tables がありません' using errcode = '22023';
  end if;

  select string_agg(k, ', ') into v_bad from jsonb_object_keys(v_data) as k where not (k = any (v_tables));
  if v_bad is not null then
    raise exception 'ファイルに、読み込めないテーブルがあります: %', v_bad using errcode = '22023';
  end if;
  -- 置き換えるので、テーブルが1つでも欠けていたら止める（欠けたテーブルを空にしてしまわないように）
  foreach t in array v_tables loop
    if jsonb_typeof(v_data -> t) is distinct from 'array' then
      raise exception 'ファイルにテーブル % がありません', t using errcode = '22023';
    end if;
  end loop;
  if jsonb_array_length(v_data -> 'settings') <> 1 then
    raise exception '設定（settings）の行は1つにしてください' using errcode = '22023';
  end if;

  -- 行の形: id があり、テーブルにない列がない
  foreach t in array v_tables loop
    for v_row, v_index in
      select e.value, e.ordinality from jsonb_array_elements(v_data -> t) with ordinality as e
    loop
      if jsonb_typeof(v_row) is distinct from 'object' or v_row ->> 'id' is null then
        raise exception '% の %件目: id がありません', t, v_index using errcode = '22023';
      end if;
      select string_agg(k, ', ') into v_bad
      from jsonb_object_keys(v_row) as k
      where not exists (
        select 1 from pg_catalog.pg_attribute a
        where a.attrelid = ('public.' || t)::regclass and a.attname = k and a.attnum > 0 and not a.attisdropped);
      if v_bad is not null then
        raise exception '% の %件目: 列 % はありません', t, v_index, v_bad using errcode = '22023';
      end if;
    end loop;
  end loop;

  -- 同じユーザーの保存（apply_op）と同時に動かない
  perform pg_advisory_xact_lock(hashtextextended('maney.apply_op:' || v_uid::text, 0));

  -- ---------- 今の状態を写しに残してから、置き換える ----------
  v_snapshot := private.take_snapshot(v_uid, 'before_import');

  -- 全体を入れ替えるので、行ごとの履歴は残さない（直前の写しで戻せる）
  perform set_config('maney.skip_history', 'on', true);

  for i in reverse cardinality(v_tables) .. 1 loop
    execute format('delete from public.%I where user_id = $1', v_tables[i]) using v_uid;
  end loop;

  foreach t in array v_tables loop
    for v_row in select e.value from jsonb_array_elements(v_data -> t) as e loop
      v_row := (v_row - server_columns) || jsonb_build_object('user_id', v_uid);
      select string_agg(quote_ident(k), ', ') into v_columns from jsonb_object_keys(v_row) as k;
      execute format(
        'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
        t, v_columns, v_columns, t)
        using v_row;
    end loop;
    v_counts := v_counts || jsonb_build_object(t, jsonb_array_length(v_data -> t));
  end loop;

  perform set_config('maney.skip_history', '', true);

  -- データが入れ替わったので、移行の番号を上げる（apply_op は、行がなければ 1 として扱う）
  insert into public.sync_state (user_id, epoch, migrated_at) values (v_uid, 2, now())
  on conflict (user_id) do update
  set epoch = public.sync_state.epoch + 1,
      migrated_at = excluded.migrated_at
  returning epoch into v_epoch;

  return jsonb_build_object('status', 'imported', 'snapshot_id', v_snapshot, 'epoch', v_epoch, 'counts', v_counts);

-- 書いている途中で制約に当たったら、ここまでの書き込み（写しも）はすべて取り消される
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception 'ファイルの中に、重なっている行があります（%）', v_constraint using errcode = '23505';
  when foreign_key_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception 'ファイルの中に、ないカード・バイト先・カテゴリを指している行があります（%）', v_constraint using errcode = '23503';
  when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception 'ファイルの中に、正しくない値の行があります（%）', v_constraint using errcode = '23514';
  when not_null_violation then
    get stacked diagnostics v_constraint = column_name;
    raise exception 'ファイルの中に、% が空の行があります', v_constraint using errcode = '23502';
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'ファイルの中に、読めない値があります（%）', sqlerrm using errcode = '22023';
end;
$$;

comment on function public.import_backup(jsonb) is
  '書き出した JSON のファイルで、ログインしている人のデータを全部置き換える（D13）。直前の写しを before_import に残す';

revoke all on function private.import_tables() from public;
revoke all on function public.import_backup(jsonb) from public, anon;
grant execute on function public.import_backup(jsonb) to authenticated;
