// まだ js/ にある関数を、src/ から呼ぶための期限付きの橋（D20）。
// 移す向きは src/ → js/ が基本（D17）なので、逆向きの呼び出しはここに集めて、一覧で見えるようにする。
// その関数を src/ に移したら、ここから消して import にする。全部消えたら、このファイルも消す
type JsFunctions = {
  /** タブを切り替える（js/app-core.js のナビ。D20 の 10 で移す） */
  sw(tab: string): void;
  renderHome(): void;
  renderCal(): void;
  moveMonthlyOffCard(cardId: string | undefined): void;
  renderCardList(): void;
  renderWdHist(): void;
};

function call<K extends keyof JsFunctions>(name: K): JsFunctions[K] {
  const fn = (globalThis as unknown as Partial<JsFunctions>)[name];
  if (typeof fn !== 'function') throw new Error(`js/ の ${name} が見つかりません`);
  return fn as JsFunctions[K];
}

export const sw = (tab: string): void => call('sw')(tab);
export const renderHome = (): void => call('renderHome')();
export const renderCal = (): void => call('renderCal')();
export const moveMonthlyOffCard = (cardId: string | undefined): void => call('moveMonthlyOffCard')(cardId);
export const renderCardList = (): void => call('renderCardList')();
export const renderWdHist = (): void => call('renderWdHist')();
