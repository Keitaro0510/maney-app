// 色と、最初のカテゴリ（D20 の 1）。js/app-core.js から移した。
// - 予定・バイト先の色の選択肢（PLAN_COLORS）と、色の読み上げの名前、カテゴリごとのグラフの色、最初のカテゴリ
// - まだ js/ の画面のために、src/main.ts が LEGACY_PALETTE を window に同じ名前で出す（期限付きの互換の層。D20）
import { state } from './state.ts';

export interface PlanColor { key: string; bg: string; fg: string; dot: string }

/** 色の読み上げ用の名前（色の選択肢はボタンで、文字がないため） */
export const COLOR_NAMES: Record<string, string> = { pink: 'ピンク', blue: '青', green: '緑', orange: 'オレンジ', purple: '紫', teal: '青緑' };

export const PLAN_COLORS: PlanColor[] = [
  { key: 'pink', bg: '#FBEAF0', fg: '#993556', dot: '#E06080' },
  { key: 'blue', bg: '#E6F1FB', fg: '#185FA5', dot: '#3A8FE0' },
  { key: 'green', bg: '#EAF3DE', fg: '#3B6D11', dot: '#5CA020' },
  { key: 'orange', bg: '#FAEEDA', fg: '#BA7517', dot: '#E09030' },
  { key: 'purple', bg: '#EEEDFE', fg: '#3C3489', dot: '#7060D0' },
  { key: 'teal', bg: '#DEF3EF', fg: '#0F6E56', dot: '#209070' },
];

/** 色の名前（key）から色を引く。なければ最初の色 */
export const planColor = (key: string | undefined): PlanColor => PLAN_COLORS.find(c => c.key === key) || PLAN_COLORS[0];

/** バイト先の色。色の指定がなければ、並びの順に色を割り当てる。バイト先がなければ最初の色 */
export function jobColorObj(job: { color?: string } | null | undefined): PlanColor {
  if (!job) return PLAN_COLORS[0];
  if (job.color) return planColor(job.color);
  const idx = (state.st.jobs as { color?: string }[]).indexOf(job);
  return PLAN_COLORS[idx >= 0 ? idx % PLAN_COLORS.length : 0];
}
export function jobColorByName(name: string): PlanColor {
  return jobColorObj((state.st.jobs as { name?: string; color?: string }[]).find(j => j.name === name));
}

/** 最初のカテゴリ（新しいユーザー・カテゴリが空のとき） */
export const DEF_EXP = ['食費', '交通費', '外食', '娯楽', '日用品', '通信費', '固定費', 'その他'];
export const DEF_INC = ['給与', 'バイト', '仕送り', 'その他'];

/** グラフのカテゴリごとの色 */
export const CAT_COL: Record<string, string> = {
  '食費': '#185FA5', '交通費': '#3B6D11', '外食': '#993556', '娯楽': '#BA7517', '日用品': '#3C3089', '通信費': '#0F6E56',
  '固定費': '#C45000', 'その他': '#5F5E5A', '給与': '#3B6D11', 'バイト': '#185FA5', '仕送り': '#BA7517',
};
/** 支出の円グラフ・日別グラフの点の色 */
export const DOTC = ['#185FA5', '#3B6D11', '#993556', '#BA7517', '#3C3489'];

/** まだ js/ が名前で使うもの（src/main.ts が window に出す。期限付きの互換の層。D20） */
export const LEGACY_PALETTE = { COLOR_NAMES, PLAN_COLORS, planColor, jobColorObj, jobColorByName, DEF_EXP, DEF_INC, CAT_COL, DOTC };
