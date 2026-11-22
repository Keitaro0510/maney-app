// 祝日（Google Calendar API）。カレンダー（src/screens/calendar.ts）とホームの棒人間（D34）が使う。
// 取得した祝日は、このファイルの中に持つ。ネットにつながらないときは、祝日なしとして動く。
// 祝日を読むための Google のキー（ブラウザで使うので公開される）。Google Cloud で、使えるサイト（keitaro0510.github.io・手元の 127.0.0.1:8765）と
// 使える API（Google Calendar API だけ）に制限している。キーを替えたら、古いキーは Google Cloud で消す
const GCAL_API_KEY = 'AIzaSyA23lyUb631P_fKLEa1LXDGtGTx8ARkj3o';
const HOLIDAY_CAL_ID = 'ja.japanese%23holiday%40group.v.calendar.google.com';
let holidayCache: Record<string, string | Record<string, never>> = {}; // { 'YYYY-MM-DD': '祝日名' }

async function fetchHolidays(year: number, month: number): Promise<void>{
  const cacheKey = `${year}-${String(month+1).padStart(2,'0')}`;
  if(holidayCache[cacheKey] !== undefined) return; // 取得済みならスキップ

  const timeMin = new Date(year, month, 1).toISOString();
  const timeMax = new Date(year, month+1, 0, 23, 59, 59).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${HOLIDAY_CAL_ID}/events?key=${GCAL_API_KEY}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true`;

  try{
    const res = await fetch(url);
    const data = await res.json() as { items?: { start: { date: string }; summary: string }[] };
    holidayCache[cacheKey] = {}; // 空でもキャッシュ（再取得しないように）
    if(data.items){
      data.items.forEach(item=>{
        const ds = item.start.date; // 'YYYY-MM-DD'
        holidayCache[ds] = item.summary;
      });
    }
  }catch(e){
    console.warn('祝日取得失敗:', e);
    holidayCache[cacheKey] = {};
  }
}

export function getHoliday(ds: string): string | null{
  return typeof holidayCache[ds] === 'string' ? holidayCache[ds] as string : null;
}

// ============================================================
// カレンダー
// ============================================================
// fetchHolidaysはholidayCacheにキー済みなら即returnするため重複呼び出しは無料。
// holidayCacheは'YYYY-MM'(取得済みマーカー)と'YYYY-MM-DD'(祝日名)が同一オブジェクトに
// 混在するため、getHoliday(ds)経由以外でキー走査しないこと
export async function ensureHolidays(dsList: string[]): Promise<void>{
  const keys=[...new Set(dsList.map(ds=>ds.slice(0,7)))];
  for(const k of keys){ const[y,mm]=k.split('-').map(Number); await fetchHolidays(y,mm-1); }
}
