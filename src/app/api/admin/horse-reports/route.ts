import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { draftHorseReport } from "@/lib/horseReportDraft";
import { isFoundingSupporter } from "@/lib/donationInsight";
import { saveFile } from "@/lib/fileStorage";
import { monthLabel, parseYearMonth } from "@/lib/monthlyReport";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const session = await requireAdmin();
  const form = await req.formData();
  const horseId = String(form.get("horseId") ?? "");
  const ym = String(form.get("ym") ?? "");
  const note = String(form.get("note") ?? "").slice(0, 4000);
  const publish = form.get("publish") === "1";
  const generate = form.get("generate") === "1";
  if (!/^[0-9a-f-]{36}$/i.test(horseId) || !parseYearMonth(ym)) {
    return NextResponse.json({ error: "馬と年月を確認してください。" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: horse, error: horseError } = await admin.from("horses").select("id, name, profile, created_at").eq("id", horseId).maybeSingle();
  if (horseError || !horse) return NextResponse.json({ error: "馬が見つかりません。" }, { status: 404 });

  const photoUrls: string[] = String(form.get("existingPhotos") ?? "").split("\n").map((line) => line.trim()).filter((line) => line.startsWith("/uploads/") || line.startsWith("https://"));
  const files = form.getAll("photos").filter((item): item is File => item instanceof File && item.size > 0);
  for (const [index, file] of files.entries()) {
    if (file.size > 8_000_000) return NextResponse.json({ error: "写真は1枚8MBまでです。" }, { status: 400 });
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const rel = `horse-reports/${horseId}/${ym}-${Date.now()}-${index}.${ext}`;
    await saveFile("public", rel, Buffer.from(await file.arrayBuffer()));
    photoUrls.push(`/uploads/${rel}`);
  }

  let body = String(form.get("body") ?? "");
  let lifeStory = String(form.get("lifeStory") ?? "");
  let usedAi = false;
  if (generate) {
    const { data: supports } = await admin.from("support_subscriptions").select("customer_id, units, started_at, canceled_at, status").eq("horse_id", horseId);
    const active = (supports ?? []).filter((row) => row.status !== "incomplete" && (!row.canceled_at || new Date(row.canceled_at as string) > new Date()));
    const units = active.reduce((sum, row) => sum + Number(row.units || 0), 0);
    const draft = await draftHorseReport({
      name: horse.name as string,
      profile: (horse.profile as string | null) ?? null,
      monthLabel: monthLabel(ym),
      staffNote: note,
      units,
      supporters: new Set(active.map((row) => row.customer_id)).size,
      deltaUnits: 0,
      history: `登録 ${String(horse.created_at).slice(0, 10)}。現在 ${units}口。保護当初から続く支援は ${active.filter((row) => isFoundingSupporter(row.started_at as string, horse.created_at as string)).length}件です。`,
    });
    body = draft.body;
    lifeStory = draft.lifeStory;
    usedAi = draft.usedAi;
  }

  const row: Record<string, unknown> = {
    horse_id: horseId,
    year_month: ym,
    staff_note: note,
    photo_urls: photoUrls,
    body,
    life_story: lifeStory,
    updated_at: new Date().toISOString(),
    updated_by: session.userId,
  };
  if (publish) row.published_at = new Date().toISOString();
  const { error } = await admin.from("horse_reports").upsert(row, { onConflict: "horse_id,year_month" });
  if (error) {
    const missing = error.code === "42P01" || error.code === "PGRST205" || /horse_reports/.test(error.message ?? "");
    return NextResponse.json({ error: missing ? "馬の報告テーブルがまだありません。" : "保存に失敗しました。" }, { status: missing ? 409 : 500 });
  }
  return NextResponse.json({ ok: true, usedAi });
}
