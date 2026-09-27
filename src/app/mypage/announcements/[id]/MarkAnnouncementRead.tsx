"use client";
import { useEffect } from "react";

/** お知らせ詳細を開いたら既読化する（自分の配信先行のみ更新）。 */
export default function MarkAnnouncementRead({ id }: { id: string }) {
  useEffect(() => {
    fetch(`/api/mypage/announcements/${id}/read`, { method: "POST" }).catch(() => {});
  }, [id]);
  return null;
}
