// 分析（D28）。家計簿タブの「分析」の中に、React で作るグラフを足していく場所。
// 今あるグラフ（カテゴリのドーナツ・日別の棒）は、移すまで ledger.ts がそのまま描く。
import * as ui from '../ui.ts';
import { mountReact } from '../react/mount.tsx';

/** 分析の画面。ここに、グラフの部品を1つずつ足す（D28 の 1〜4） */
function Analysis() {
  return <div data-analysis="ready" hidden />;
}

/** 起動時に1度だけ、React の画面を差し込む。 */
export function bindAnalysis(): void {
  mountReact(ui.elementById('analysis-root'), <Analysis />);
}
