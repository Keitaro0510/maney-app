// 棒人間の着せ替え（D42）。小物の一覧と、選んだ組み合わせの検査。画面を使わない関数だけ置く（テストできるように）。
// 小物の絵は SVG の断片。頭の小物は「頭の中心が原点・上が -y」、首の小物は「肩が原点・上が -y」で描く
// （動かすときは、頭・胴の傾きに合わせて、まとめて回す。src/mascot-motion.ts）。服と靴は色だけを持つ

/** 着せ替えの組み合わせ（それぞれ、小物の id。'none' は何も付けない） */
export type Outfit = { head: string; neck: string; top: string; shoes: string };
export type OutfitSlot = keyof Outfit;

export const NO_OUTFIT: Outfit = { head: 'none', neck: 'none', top: 'none', shoes: 'none' };

export type Item = { label: string; /** 頭・首の小物の絵（SVG の断片） */ svg?: string; /** 服・靴の色 */ color?: string };

export const ITEMS: Record<OutfitSlot, Record<string, Item>> = {
  head: {
    none: { label: 'なし' },
    cap: {
      label: 'ぼうし',
      svg: '<path d="M-6.8-1.4a6.8 6.8 0 0 1 13.6 0z" fill="#E5533D" stroke="#B23A28" stroke-width="1" stroke-linejoin="round"/><path d="M2-1.6h9" stroke="#B23A28" stroke-width="2.4" stroke-linecap="round"/>',
    },
    beanie: {
      label: 'ニット帽',
      svg: '<path d="M-7-1.2a7 7 0 0 1 14 0z" fill="#4F8FD6"/><rect x="-7.6" y="-2.8" width="15.2" height="3" rx="1.3" fill="#2F6DB0"/><circle cy="-8.8" r="2.3" fill="#fff" stroke="#9AA9B8" stroke-width=".8"/>',
    },
    ribbon: {
      label: 'リボン',
      svg: '<path d="M0-7.6-5.6-11.4v7.6zM0-7.6 5.6-11.4v7.6z" fill="#F178B6" stroke="#D6458F" stroke-width=".8" stroke-linejoin="round"/><circle cy="-7.6" r="1.7" fill="#D6458F"/>',
    },
    headband: {
      label: 'はちまき',
      svg: '<path d="M-6.6-2.4Q0-5.4 6.6-2.4" stroke="#E5533D" stroke-width="2.8" fill="none" stroke-linecap="round"/><path d="M6.4-2.6 11 .2M6.2-2.2l4.6 4" stroke="#E5533D" stroke-width="1.8" stroke-linecap="round"/>',
    },
  },
  neck: {
    none: { label: 'なし' },
    scarf: {
      label: 'マフラー',
      svg: '<path d="M-5.2-.6Q0 2.6 5.2-.6" stroke="#E5533D" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M3 1.2 4.6 8.4" stroke="#E5533D" stroke-width="3" stroke-linecap="round"/><path d="M3.4 5.2 4.2 5.4" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>',
    },
    bowtie: {
      label: 'ちょうネクタイ',
      svg: '<path d="M0 1-4.6-1.6v5.2zM0 1 4.6-1.6v5.2z" fill="#7B4FC8" stroke="#5B35A0" stroke-width=".8" stroke-linejoin="round"/><circle cy="1" r="1.2" fill="#5B35A0"/>',
    },
    tie: {
      label: 'ネクタイ',
      svg: '<path d="M0 .8-1.7 2.4 0 3.6 1.7 2.4z" fill="#2F6DB0"/><path d="M0 3.4-1.9 9 0 11.4 1.9 9z" fill="#2F6DB0"/>',
    },
  },
  top: {
    none: { label: 'なし' },
    red: { label: '赤', color: '#E5533D' },
    blue: { label: '青', color: '#4F8FD6' },
    yellow: { label: '黄', color: '#F5B82E' },
    green: { label: '緑', color: '#4FAE72' },
    pink: { label: 'ピンク', color: '#F178B6' },
  },
  shoes: {
    none: { label: 'なし' },
    red: { label: '赤', color: '#E5533D' },
    blue: { label: '青', color: '#4F8FD6' },
    brown: { label: '茶', color: '#8A5A3C' },
    white: { label: '白', color: '#E7EAEE' },
  },
};

/** 保存してあった値（どんな形でも）を、いまある小物だけの組み合わせにそろえる。知らない id や壊れた値は、何も付けない */
export function parseOutfit(raw: unknown): Outfit {
  const out = { ...NO_OUTFIT };
  if (typeof raw !== 'object' || raw === null) return out;
  const src = raw as Record<string, unknown>;
  for (const slot of Object.keys(out) as OutfitSlot[]) {
    const id = src[slot];
    if (typeof id === 'string' && Object.prototype.hasOwnProperty.call(ITEMS[slot], id)) out[slot] = id;
  }
  return out;
}

/** 頭の王冠（記録が7日以上つづいているとき）。ほかの小物とは別に、頭の上へ重ねる絵 */
export const CROWN_SVG =
  '<g transform="translate(-9 -17.4) scale(.56)"><path d="M3 20 1.5 6 9 12.5 16 2.5l7 10L30.5 6 29 20Z" fill="#F5B82E" stroke="#C98A12" stroke-width="1.8" stroke-linejoin="round"/>' +
  '<circle cx="1.5" cy="5.5" r="2.2" fill="#E5533D"/><circle cx="16" cy="2.5" r="2.4" fill="#E5533D"/><circle cx="30.5" cy="5.5" r="2.2" fill="#E5533D"/></g>';
/** 頭に小物を付けているとき、王冠をどれだけ上げるか（px） */
export const CROWN_LIFT_WITH_HEAD_ITEM = 4.5;
