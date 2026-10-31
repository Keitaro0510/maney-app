// お金の計算（D11。手順8の段2）。推定残高・残高推移・カードの集計・給料・「給料日までに使えるお金」を、ここ1か所で数える。
// 互換の st ではなく、DB の行（currentRows() の形: { settings: [...], cards: [...], ... }）を読む（D9）。画面を使わないので Node でテストできる。
//
// 数え方（D11）:
// - 口座の残高だけを見る。現金の支出は口座から引かない（ATM で引き出したときに引く）
// - 口座に入る: 給料（実績があれば実績、なければシフトからの見込み）・固定収入・固定費の「収入」・家計簿の口座振込の収入
// - 口座から出る: 口座払いの固定費・カードの引き落とし（実績があれば実績、なければ集計）・ATM の引き出し・家計簿の口座払いの支出
// - 予定の予算: カード払いはそのカードの集計に入れる。それ以外は予定の日に出ていくお金として、これから先の見込みにだけ数える。「済み」は数えない
// - 固定費は「いつから・いつまで」の外の月を数えない（D14）
// 日付は 'YYYY-MM-DD'（端末の時刻での日付）。月（m）は 0 が1月。
(function (root) {
  'use strict';

  const Clock = root.MoneyClock || (typeof require === 'function' ? require('./clock.js') : null);
  const DAY = 24 * 60 * 60 * 1000;

  // ---------- 日付 ----------
  const parse = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  const keyOf = date => Clock.dayKey(date);
  const addDays = (key, n) => { const d = parse(key); d.setDate(d.getDate() + n); return keyOf(d); };
  const addMonth = (y, m, n) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; };
  const ym = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
  // 「毎月○日」のその月の日付。月にない日は月末（js/clock.js）
  const monthKey = (y, m, day) => keyOf(new Date(y, m, Clock.monthDay(y, m, day)));
  // from の月から to の月までの {y, m}
  function monthsBetween(fromKey, toKey) {
    const list = [];
    const f = parse(fromKey), t = parse(toKey);
    for (let y = f.getFullYear(), m = f.getMonth(); y < t.getFullYear() || (y === t.getFullYear() && m <= t.getMonth());) {
      list.push({ y, m });
      ({ y, m } = addMonth(y, m, 1));
    }
    return list;
  }

  // ---------- 行の準備 ----------
  const byPosition = (a, b) => ((a.position || 0) - (b.position || 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // 同じ行の集まりなら、作り直さない（1回の描画で何度も呼ばれるため）
  let lastRows = null, lastModel = null;
  function model(rows) {
    if (rows && rows === lastRows) return lastModel;
    const settings = (rows.settings || [])[0] || {};
    const m = {
      settings,
      cards: [...(rows.cards || [])].sort(byPosition),
      jobs: [...(rows.jobs || [])].sort(byPosition),
      ledger: rows.ledger_entries || [],
      shifts: rows.shifts || [],
      plans: rows.plans || [],
      fixedCosts: [...(rows.fixed_costs || [])].sort(byPosition),
      fixedIncomes: [...(rows.fixed_incomes || [])].sort(byPosition),
      withdrawals: rows.withdrawals || [],
      salaryActuals: new Map((rows.salary_actuals || []).map(a => [`${a.job_id}|${a.pay_month.slice(0, 7)}`, a])),
      cardActuals: new Map((rows.card_bill_actuals || []).map(a => [`${a.card_id}|${a.bill_month.slice(0, 7)}`, a])),
    };
    lastRows = rows; lastModel = m;
    return m;
  }
  const asModel = x => (x && x.salaryActuals instanceof Map ? x : model(x));

  // 固定費がその月に数えるものか（D14: いつから・いつまで。空なら制限なし）
  function activeInMonth(fc, y, m) {
    const first = `${ym(y, m)}-01`;
    if (fc.start_month && first < fc.start_month) return false;
    if (fc.end_month && first > fc.end_month) return false;
    return true;
  }

  // ---------- 給料 ----------
  // 1回のシフトの給料。shift: { start, end, rest }（'HH:MM' か 'HH:MM:SS'）、job: { wage, nightStart, nightRate, transport }
  // 深夜の割増（nightStart から。なければ 22:00）、休憩は時間の割合で引く、交通費は往復
  function shiftIncome(shift, job) {
    if (!job) return { wage: 0, nightWage: 0, transport: 0, total: 0, nightH: 0, restMin: 0 };
    const [sh, sm] = String(shift.start).split(':').map(Number);
    const [eh, em] = String(shift.end).split(':').map(Number);
    const startMin = sh * 60 + sm, endMin = eh * 60 + em;
    const [nh, nn] = String(job.nightStart || '22:00').split(':').map(Number);
    const nsMin = nh * 60 + nn, nightRate = (parseInt(job.nightRate) || 25) / 100;
    let normalMin = 0, nightMin = 0;
    if (endMin <= nsMin) normalMin = Math.max(0, endMin - startMin);
    else if (startMin >= nsMin) nightMin = Math.max(0, endMin - startMin);
    else { normalMin = nsMin - startMin; nightMin = endMin - nsMin; }
    const restMin = Math.max(0, parseInt(shift.rest) || 0);
    const totalMin = normalMin + nightMin;
    if (restMin > 0 && totalMin > 0) {
      const ratio = Math.max(0, totalMin - restMin) / totalMin;
      normalMin *= ratio; nightMin *= ratio;
    }
    const normalH = normalMin / 60, nightH = nightMin / 60;
    const wage = Math.round(normalH * job.wage);
    const nightWage = Math.round(nightH * (job.wage * (1 + nightRate)));
    const transport = (parseInt(job.transport) || 0) * 2;
    return { wage, nightWage, transport, total: wage + nightWage + transport, nightH, restMin };
  }
  const jobForCalc = j => ({ wage: j.wage, nightStart: j.night_start, nightRate: j.night_rate, transport: j.transport });

  // そのバイト先の、その月のシフトの給料の合計（交通費も入れる）
  function monthJobIncome(rows, job, y, m) {
    const mdl = asModel(rows);
    const prefix = ym(y, m);
    return mdl.shifts
      .filter(s => s.job_id === job.id && s.date.startsWith(prefix))
      .reduce((sum, s) => sum + shiftIncome({ start: s.start_time, end: s.end_time, rest: s.rest_minutes }, jobForCalc(job)).total, 0);
  }

  // 給料日（バイト先にあればそれ、なければ設定の給料日、なければ10日）
  const payDayOf = (rows, job) => parseInt(job && job.pay_day) || parseInt(asModel(rows).settings.shift_pay_day) || 10;

  // payY 年 payM 月に入る給料: 実績があれば実績、なければ前の月のシフトからの見込み
  function salary(rows, job, payY, payM) {
    const mdl = asModel(rows);
    const actual = mdl.salaryActuals.get(`${job.id}|${ym(payY, payM)}`);
    if (actual) return { amount: actual.actual_amount, actual: true };
    const work = addMonth(payY, payM, -1);
    return { amount: monthJobIncome(mdl, job, work.y, work.m), actual: false };
  }

  // ---------- カード ----------
  // 締め日（28以上は月末）
  const cardCloseDay = (card, y, m) => (card.close_day >= 28 ? Clock.daysInMonth(y, m) : card.close_day);

  // billY 年 billM 月に引き落とされる分の集計。前々月の締め日の次の日から、前月の締め日まで
  // カード払いの家計簿の支出・カード払いの固定費（その月に数えるもの）・カード払いの予定（済みでないもの）
  function cardCycle(rows, card, billY, billM) {
    const mdl = asModel(rows);
    const prev = addMonth(billY, billM, -1), prev2 = addMonth(billY, billM, -2);
    const cs = keyOf(new Date(prev2.y, prev2.m, cardCloseDay(card, prev2.y, prev2.m) + 1));
    const ce = keyOf(new Date(prev.y, prev.m, cardCloseDay(card, prev.y, prev.m)));
    const inCycle = key => key >= cs && key <= ce;
    const ledgerAmt = mdl.ledger
      .filter(l => l.kind === 'expense' && l.card_id === card.id && inCycle(l.date))
      .reduce((a, l) => a + l.amount, 0);
    const fixedAmt = mdl.fixedCosts
      .filter(fc => fc.kind === 'expense' && fc.payment_method === 'card' && fc.card_id === card.id)
      .reduce((a, fc) => {
        const hit = monthsBetween(cs, ce).find(({ y, m }) => inCycle(monthKey(y, m, fc.day)) && activeInMonth(fc, y, m));
        return hit ? a + fc.amount : a;
      }, 0);
    const planAmt = mdl.plans
      .filter(p => !p.done && p.budget > 0 && p.card_id === card.id && inCycle(p.start_date))
      .reduce((a, p) => a + p.budget, 0);
    return { cs, ce, billY, billM, billD: Clock.monthDay(billY, billM, card.bill_day), amount: ledgerAmt + fixedAmt + planAmt };
  }

  // billY 年 billM 月の引き落とし額: 実績があれば実績、なければ集計
  function cardBill(rows, card, billY, billM) {
    const mdl = asModel(rows);
    const actual = mdl.cardActuals.get(`${card.id}|${ym(billY, billM)}`);
    if (actual) return { amount: actual.actual_amount, actual: true };
    return { amount: cardCycle(mdl, card, billY, billM).amount, actual: false };
  }

  // 今日から見た「確定」（次に引き落とされる）と「集計中」（その次）の引き落としの月
  function cardCycleMonths(card, todayKey) {
    const t = parse(todayKey), y = t.getFullYear(), m = t.getMonth();
    const afterClose = t.getDate() > cardCloseDay(card, y, m);
    return { confirmed: addMonth(y, m, afterClose ? 1 : 0), pending: addMonth(y, m, afterClose ? 2 : 1) };
  }

  // ---------- 口座のお金の動き ----------
  // fromKey から toKey まで（両端を含む）の、口座に入る（+）・出る（-）お金。opts.plans で予定の予算も入れる（これから先の見込み用）
  function accountEvents(rows, fromKey, toKey, opts = {}) {
    const mdl = asModel(rows);
    if (fromKey > toKey) return [];
    const events = [];
    const inRange = key => key >= fromKey && key <= toKey;
    const add = (date, amount, kind, label, ref) => { if (amount) events.push({ date, amount, kind, label, ref }); };
    const months = monthsBetween(fromKey, toKey);

    for (const fi of mdl.fixedIncomes) {
      for (const { y, m } of months) { const d = monthKey(y, m, fi.day); if (inRange(d)) add(d, fi.amount, 'fixed_income', fi.name, fi.id); }
    }
    for (const fc of mdl.fixedCosts) {
      const sign = fc.kind === 'income' ? 1 : fc.payment_method === 'bank' ? -1 : 0;
      if (!sign) continue; // 現金払いは口座の外、カード払いはカードの集計に入る
      for (const { y, m } of months) {
        const d = monthKey(y, m, fc.day);
        if (inRange(d) && activeInMonth(fc, y, m)) add(d, sign * fc.amount, fc.kind === 'income' ? 'fixed_income' : 'fixed_cost', fc.name, fc.id);
      }
    }
    for (const job of mdl.jobs) {
      const pay = payDayOf(mdl, job);
      for (const { y, m } of months) {
        const d = monthKey(y, m, pay);
        if (inRange(d)) { const s = salary(mdl, job, y, m); add(d, s.amount, 'salary', job.name, job.id); }
      }
    }
    for (const card of mdl.cards) {
      for (const { y, m } of months) {
        const d = monthKey(y, m, card.bill_day);
        if (inRange(d)) add(d, -cardBill(mdl, card, y, m).amount, 'card_bill', card.name, card.id);
      }
    }
    for (const w of mdl.withdrawals) if (inRange(w.date)) add(w.date, -w.amount, 'withdrawal', 'ATM の引き出し', w.id);
    for (const l of mdl.ledger) {
      if (l.payment_method !== 'bank' || !inRange(l.date)) continue;
      add(l.date, l.kind === 'income' ? l.amount : -l.amount, l.kind === 'income' ? 'ledger_income' : 'ledger_expense', l.name, l.id);
    }
    if (opts.plans) {
      for (const p of mdl.plans) {
        if (!p.done && p.budget > 0 && !p.card_id && inRange(p.start_date)) add(p.start_date, -p.budget, 'plan', p.title, p.id);
      }
    }
    return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  const sum = events => events.reduce((a, e) => a + e.amount, 0);

  // 今日の口座の残高（推定）: 基準日の残高に、基準日から今日までの動きを足す（予定は入れない）
  function balanceAt(rows, todayKey) {
    const mdl = asModel(rows);
    const base = mdl.settings.base_date || todayKey;
    const start = mdl.settings.acct_base || 0;
    if (base > todayKey) return start;
    return start + sum(accountEvents(mdl, base, todayKey));
  }

  // 今日から days 日先までの、日ごとの残高の見込み（予定の予算も入れる）。[{ date, balance }]
  function balanceSeries(rows, todayKey, days = 90) {
    const mdl = asModel(rows);
    const base = mdl.settings.base_date || todayKey;
    const byDay = new Map();
    for (const e of accountEvents(mdl, addDays(todayKey, 1), addDays(todayKey, days), { plans: true })) {
      if (e.date > base) byDay.set(e.date, (byDay.get(e.date) || 0) + e.amount);
    }
    let balance = balanceAt(mdl, todayKey);
    const list = [];
    for (let i = 0; i <= days; i++) {
      const date = addDays(todayKey, i);
      if (i > 0) balance += byDay.get(date) || 0;
      list.push({ date, balance });
    }
    return list;
  }

  // 次の給料日（今のバイト先のうち、いちばん近いもの。バイト先がなければ設定の給料日）。今日が給料日なら、その次
  function nextPayday(rows, todayKey) {
    const mdl = asModel(rows);
    const t = parse(todayKey), y = t.getFullYear(), m = t.getMonth(), d = t.getDate();
    const jobs = mdl.jobs.filter(j => !j.deleted_at);
    const payDays = jobs.length ? jobs.map(j => payDayOf(mdl, j)) : [parseInt(mdl.settings.shift_pay_day) || 10];
    let best = null;
    for (const p of payDays) {
      const thisMonth = Clock.monthDay(y, m, p);
      let date;
      if (d < thisMonth) date = keyOf(new Date(y, m, thisMonth));
      else { const n = addMonth(y, m, 1); date = monthKey(n.y, n.m, p); }
      const days = Math.round((parse(date) - t) / DAY);
      if (!best || days < best.days) best = { date, days };
    }
    return best;
  }

  // 給料日までに使えるお金（D11）: 次の給料日の前の日に口座に残る見込みから、それまでの予定（カード払い以外）を引いた額。
  // 0 で止めない（足りないときはマイナス）。perDay は給料日までの1日あたり
  function spendable(rows, todayKey) {
    const mdl = asModel(rows);
    const pay = nextPayday(mdl, todayKey);
    const until = addDays(pay.date, -1);
    let amount = balanceAt(mdl, todayKey) + sum(accountEvents(mdl, addDays(todayKey, 1), until));
    // 予定: 今日より前に始まって、まだ終わっていないものも入れる（済みにしていなければ、これから払う）
    const plans = mdl.plans.filter(p => !p.done && p.budget > 0 && !p.card_id && p.end_date >= todayKey && p.start_date <= until);
    amount -= plans.reduce((a, p) => a + p.budget, 0);
    return { amount, perDay: pay.days > 0 ? Math.floor(amount / pay.days) : amount, days: pay.days, payday: pay.date, until };
  }

  // これから先のお金の動き（今日の次の日から days 日。予定も入れる）
  const upcoming = (rows, todayKey, days = 14) => accountEvents(rows, addDays(todayKey, 1), addDays(todayKey, days), { plans: true });

  const MoneyCalc = {
    model, shiftIncome, monthJobIncome, payDayOf, salary, cardCloseDay, cardCycle, cardBill, cardCycleMonths,
    accountEvents, balanceAt, balanceSeries, nextPayday, spendable, upcoming, activeInMonth,
  };
  root.MoneyCalc = MoneyCalc;
  if (typeof module !== 'undefined' && module.exports) module.exports = MoneyCalc;
})(typeof globalThis !== 'undefined' ? globalThis : this);
