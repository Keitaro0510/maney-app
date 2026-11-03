// シフト・給与の計算と実績（D20 の 5）。画面とホーム・カレンダーで共有する。
import { state } from './state.ts';
import { addM, monthDay, toDS } from './dates.ts';
import { shiftIncome, type ShiftIncome, type JobRates } from './money.ts';
import type { StJob, StShift, StShiftActual } from './compat.ts';

export const monthShifts = (y: number, m: number): StShift[] => state.st.shifts.filter(s => { const d = new Date(s.date); return d.getFullYear() === y && d.getMonth() === m; });
export const closeDay = (y: number, m: number): number => parseInt(String(state.st.shiftCloseDay)) >= 28 ? new Date(y, m + 1, 0).getDate() : parseInt(String(state.st.shiftCloseDay));
export const jobPayDay = (job?: StJob | null): number => parseInt(String(job?.payDay)) || parseInt(String(state.st.shiftPayDay)) || 10;
export function jobCloseDayNum(job: StJob | null | undefined, y: number, m: number): number {
  const cl = parseInt(String(job?.closeDay)) || parseInt(String(state.st.shiftCloseDay)) || 31;
  return cl >= 28 ? new Date(y, m + 1, 0).getDate() : cl;
}
export const salaryKeyForShiftMonth = (jobName: string, y: number, m: number): string => { const pm = addM(y, m, 1); return `${jobName}|${pm.y}-${String(pm.m + 1).padStart(2, '0')}`; };
export const getActualSalary = (jobName: string, y: number, m: number): StShiftActual | undefined =>
  state.st.actualInputs.find((a): a is StShiftActual => a.type === 'shift' && a.job === jobName && a.salaryKey === salaryKeyForShiftMonth(jobName, y, m));
export function setActualSalary(jobName: string, y: number, m: number, amount: number): void {
  const key = salaryKeyForShiftMonth(jobName, y, m), pm = addM(y, m, 1), job = state.st.jobs.find(j => j.name === jobName);
  const date = toDS(pm.y, pm.m, monthDay(pm.y, pm.m, jobPayDay(job)));
  const ei = state.st.actualInputs.findIndex(a => a.type === 'shift' && a.job === jobName && a.salaryKey === key);
  const entry: StShiftActual = { type: 'shift', job: jobName, salaryKey: key, date, actualAmount: amount, estimatedAmount: totalShiftIncNoTransportForJob(jobName, y, m) };
  if (ei >= 0) { entry._id = state.st.actualInputs[ei]._id; state.st.actualInputs[ei] = entry; }
  else state.st.actualInputs.push(entry);
}
export function calcShiftInc(shift: Pick<StShift, 'job' | 'start' | 'end' | 'rest'>): ShiftIncome {
  const job = state.st.jobs.find(j => j.name === shift.job);
  return shiftIncome({ start: shift.start ?? '', end: shift.end ?? '', rest: shift.rest }, job as JobRates | undefined);
}
export const totalShiftInc = (y: number, m: number): number => monthShifts(y, m).reduce((a, s) => a + calcShiftInc(s).total, 0);
export const totalShiftIncNoTransport = (y: number, m: number): number => monthShifts(y, m).reduce((a, s) => { const r = calcShiftInc(s); return a + r.wage + r.nightWage; }, 0);
export const totalTransport = (y: number, m: number): number => monthShifts(y, m).reduce((a, s) => a + calcShiftInc(s).transport, 0);
export const jobMonthShifts = (jobName: string, y: number, m: number): StShift[] => monthShifts(y, m).filter(s => s.job === jobName);
export const totalShiftIncForJob = (jobName: string, y: number, m: number): number => jobMonthShifts(jobName, y, m).reduce((a, s) => a + calcShiftInc(s).total, 0);
export const totalShiftIncNoTransportForJob = (jobName: string, y: number, m: number): number => jobMonthShifts(jobName, y, m).reduce((a, s) => { const r = calcShiftInc(s); return a + r.wage + r.nightWage; }, 0);
export const LEGACY_SHIFTS = { monthShifts, closeDay, jobPayDay, jobCloseDayNum, salaryKeyForShiftMonth, getActualSalary, setActualSalary, calcShiftInc, totalShiftInc, totalShiftIncNoTransport, totalTransport, jobMonthShifts, totalShiftIncForJob, totalShiftIncNoTransportForJob };
