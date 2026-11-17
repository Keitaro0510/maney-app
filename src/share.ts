// カレンダーの共有（D39）。相手の予定とシフトを、読み取り専用で見る。
// サーバーとのやりとりは、共有用の関数（supabase/migrations/20261117120000_calendar_share.sql）だけ。
// 相手の予算・カード・メモ・時給は、サーバーが返さない（ここには届かない）。
import { getSupa } from './supa.ts';
import { planTimeOnDay } from './plans.ts';

export type SharedPlan = {
  id: string; title: string; start_date: string; end_date: string;
  start_time: string | null; end_time: string | null; color: string;
};
export type SharedShift = { id: string; date: string; start_time: string; end_time: string; job: string };
export type SharedCalendar = { plans: SharedPlan[]; shifts: SharedShift[] };

/** direction: viewing＝自分が見る側（nickname は相手の呼び名） / sharing＝自分が見せる側（other_email が相手） */
export type ShareRow = {
  id: string; direction: 'viewing' | 'sharing'; status: 'pending' | 'approved';
  nickname: string; other_email: string; owner_id: string;
};

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupa().rpc(fn, args);
  if (error) throw new Error(error.message || '共有の操作に失敗しました');
  return data as T;
}

export const getMyShareCode = (): Promise<string> => call<string>('get_my_share_code');
export const resetMyShareCode = (): Promise<string> => call<string>('reset_my_share_code');
export const requestShare = (code: string, nickname: string): Promise<void> =>
  call<void>('request_calendar_share', { p_code: code, p_nickname: nickname });
export const listShares = (): Promise<ShareRow[]> => call<ShareRow[]>('list_calendar_shares').then(r => r || []);
export const respondShare = (id: string, approve: boolean): Promise<void> =>
  call<void>('respond_calendar_share', { p_id: id, p_approve: approve });
export const revokeShare = (id: string): Promise<void> => call<void>('revoke_calendar_share', { p_id: id });
export const fetchSharedCalendar = (owner: string, from: string, to: string): Promise<SharedCalendar> =>
  call<SharedCalendar>('shared_calendar', { p_owner: owner, p_from: from, p_to: to })
    .then(r => ({ plans: r?.plans || [], shifts: r?.shifts || [] }));

/** 16桁のコードを、4桁ずつ区切って見せる（入力のときは区切りがあってもなくてもよい） */
export const formatShareCode = (code: string): string => code.replace(/(.{4})(?=.)/g, '$1-');

const hhmm = (t: string | null | undefined): string => (t ? t.slice(0, 5) : '');

/** その日にかかる予定（期間予定は、初日から最終日まで） */
export function sharedPlansOnDay(plans: SharedPlan[], ds: string): SharedPlan[] {
  return plans.filter(p => ds >= p.start_date && ds <= p.end_date);
}

/** 予定の、その日の時刻（期間予定は、初日が開始・最終日が終了・中日は終日。自分の予定と同じ規則） */
export function sharedPlanTime(p: SharedPlan, ds: string): { start: string; end: string; min: number } {
  return planTimeOnDay(
    { date: p.start_date, dateStart: p.start_date, dateEnd: p.end_date, timeStart: hhmm(p.start_time), timeEnd: hhmm(p.end_time) },
    ds,
  );
}

export function sharedShiftsOnDay(shifts: SharedShift[], ds: string): SharedShift[] {
  return shifts.filter(s => s.date === ds);
}

export const sharedShiftTime = (s: SharedShift): { start: string; end: string } => ({ start: hhmm(s.start_time), end: hhmm(s.end_time) });
