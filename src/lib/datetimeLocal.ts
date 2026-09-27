// <input type="datetime-local"> ⇄ 日本時間(JST, UTC+9固定・夏時間なし)の変換。
// サーバー実行環境（Vercelは UTC）やブラウザのローカルタイムゾーンに依存せず、
// 常に「入力欄は日本時間」として扱うことで、選択した時刻と保存・表示される時刻のズレを防ぐ。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 保存済みのUTC ISO文字列 → <input type="datetime-local"> に表示する "YYYY-MM-DDTHH:mm"（日本時間）
export function isoToJstLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 16);
}

// <input type="datetime-local"> の値（日本時間として入力された）→ UTCのISO文字列
export function jstLocalInputToIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const d = new Date(`${local}:00+09:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
