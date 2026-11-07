// React の画面を、既存の HTML の中の1か所に差し込む入口（D27）。
// 新しい画面（分析など）は、画面の枠になる要素を用意して、ここから描画する。既存の画面は触らない。
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const roots = new WeakMap<Element, Root>();

/** el の中に node を描画する。同じ el にもう一度呼ぶと、作り直さず中身だけ更新する */
export function mountReact(el: Element, node: ReactNode): void {
  let root = roots.get(el);
  if (!root) { root = createRoot(el); roots.set(el, root); }
  root.render(node);
}

/** el の React の画面を片付ける（画面を閉じるとき） */
export function unmountReact(el: Element): void {
  roots.get(el)?.unmount();
  roots.delete(el);
}
