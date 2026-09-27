import Image from "next/image";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import horseImage from "@/assets/images/horse.png";
import HorseForm from "./HorseForm";

export default async function HorsesPage() {
  const supabase = createSupabaseServerClient();
  const { data: horses } = await supabase
    .from("horses")
    .select("*")
    .order("sort_order");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">馬マスタ</h1>
      <HorseForm />
      <div className="card p-0 overflow-auto">
        <table className="table">
          <thead><tr><th className="w-12 text-right">No.</th><th>名前</th><th>カナ</th><th>性</th><th>生年</th><th>支援</th><th>並び順</th><th></th></tr></thead>
          <tbody>
            {(horses ?? []).map((h: any, i: number) => (
              <tr key={h.id}>
                <td className="text-right text-ink-mute tabular-nums">{i + 1}</td>
                <td>
                  <div className="flex items-center gap-3">
                    {h.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={h.image_url} alt={h.name} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-brand-50 overflow-hidden shrink-0">
                        <Image src={horseImage} alt="horse" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <span className="font-semibold">{h.name}</span>
                  </div>
                </td>
                <td>{h.name_kana ?? "—"}</td>
                <td>{h.sex ?? "—"}</td>
                <td>{h.birth_year ?? "—"}</td>
                <td>{h.is_supportable ? "受付中" : "停止"}</td>
                <td>{h.sort_order}</td>
                <td className="text-right">
                  <Link href={`/admin/horses/${h.id}`} className="text-brand underline">編集</Link>
                </td>
              </tr>
            ))}
            {(horses ?? []).length === 0 && (
              <tr><td colSpan={8} className="text-center py-6 text-ink-mute">まだ登録されていません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
