"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatYen, statusLabel } from "@/lib/format";
import TeamNameEditor from "./TeamNameEditor";

type Horse = { id: string; name: string };
type SpecialTeam = {
  id: string;
  horse_id: string | null;
  horse?: { name: string } | null;
  team_name: string | null;
  monthly_amount: number;
  status: string;
  started_at: string;
  canceled_at: string | null;
};
type RptContract = {
  id: string;
  status: string;
  started_at: string;
  canceled_at: string | null;
  monthly_amount: number;
};

export default function SpecialMembershipsManager({
  customerId,
  specialTeams,
  rptContracts,
  horses,
  rptPlanId,
  rptMonthly,
}: {
  customerId: string;
  specialTeams: SpecialTeam[];
  rptContracts: RptContract[];
  horses: Horse[];
  rptPlanId: string | null;
  rptMonthly: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [teamOpen, setTeamOpen] = useState(false);
  const [teamHorse, setTeamHorse] = useState<string>(horses[0]?.id ?? "");
  const [teamName, setTeamName] = useState<string>("");

  const hasActiveRpt = rptContracts.some((c) => c.status === "active" || c.status === "past_due");

  const refresh = () => router.refresh();

  const addTeam = async () => {
    setErr(null);
    if (!teamHorse) return setErr("馬を選択してください");
    setBusy("__addTeam");
    const res = await fetch("/api/admin/special-team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_id: customerId, horse_id: teamHorse, team_name: teamName }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setErr(j.error ?? "登録に失敗しました");
    setTeamOpen(false);
    setTeamName("");
    refresh();
  };

  const cancelTeam = async (id: string) => {
    if (!confirm("この特別チーム会員を停止します。よろしいですか？\n（Stripe側の解約は別途必要です）")) return;
    setBusy(id);
    setErr(null);
    const res = await fetch(`/api/admin/special-team/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setErr(j.error ?? "停止に失敗しました");
    }
    refresh();
  };

  const addRpt = async () => {
    setErr(null);
    if (!rptPlanId) return setErr("リタポプランが見つかりません（プラン設定をご確認ください）");
    setBusy("__addRpt");
    const res = await fetch("/api/admin/contracts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_id: customerId, plan_id: rptPlanId, status: "active" }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setErr(j.error ?? "登録に失敗しました");
    refresh();
  };

  const cancelRpt = async (id: string) => {
    if (!confirm("このリタポ会員を停止します。よろしいですか？\n（Stripe側の解約は別途必要です）")) return;
    setBusy(id);
    setErr(null);
    const res = await fetch(`/api/admin/contracts/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setErr(j.error ?? "停止に失敗しました");
    }
    refresh();
  };

  return (
    <div className="space-y-5">
      {err && <p className="text-danger text-sm">{err}</p>}

      {/* 特別チーム（ガンガン） */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">特別チーム会員（ガンガンなど）</h3>
          {!teamOpen ? (
            <button className="btn-primary !py-1.5 !px-3 text-sm" onClick={() => setTeamOpen(true)}>
              ＋ 特別チームを追加
            </button>
          ) : (
            <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={() => setTeamOpen(false)}>
              キャンセル
            </button>
          )}
        </div>

        {teamOpen && (
          <div className="grid md:grid-cols-3 gap-2 p-3 bg-surface-soft rounded-xl border border-surface-line">
            <div>
              <label className="label">馬</label>
              <select className="input" value={teamHorse} onChange={(e) => setTeamHorse(e.target.value)}>
                {horses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">チーム名（任意）</label>
              <input
                className="input"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="目の負傷『ガンガン支援チーム』"
              />
            </div>
            <div className="flex items-end">
              <button className="btn-primary w-full" onClick={addTeam} disabled={busy === "__addTeam"}>
                {busy === "__addTeam" ? "登録中..." : "追加する"}
              </button>
            </div>
            <p className="md:col-span-3 text-xs text-ink-soft">
              既にStripe等で課金中の会員を「記録」として登録します。新たな決済は発生しません。月額合計には加算されず、特別参加タグとして表示されます。
            </p>
          </div>
        )}

        <table className="table">
          <thead>
            <tr>
              <th className="w-12 text-right">No.</th>
              <th>馬</th>
              <th>チーム名</th>
              <th>月額</th>
              <th>状態</th>
              <th>開始</th>
              <th>停止</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {specialTeams.map((x, i) => (
              <tr key={x.id}>
                <td className="text-right text-ink-mute tabular-nums">{i + 1}</td>
                <td>{x.horse?.name ?? "—"}</td>
                <td>
                  <TeamNameEditor membershipId={x.id} initialName={x.team_name ?? ""} />
                </td>
                <td>{formatYen(x.monthly_amount)}</td>
                <td>{statusLabel(x.status)}</td>
                <td>{formatDate(x.started_at)}</td>
                <td>{x.canceled_at ? formatDate(x.canceled_at) : "—"}</td>
                <td className="text-right">
                  {x.status !== "canceled" && (
                    <button
                      className="btn-danger !py-1 !px-2 text-xs"
                      onClick={() => cancelTeam(x.id)}
                      disabled={busy === x.id}
                    >
                      停止
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {specialTeams.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-ink-mute py-3">
                  特別チーム会員の登録はありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* リタポ（RPT） */}
      <div className="space-y-2 pt-3 border-t border-surface-line">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">リタポメンバー（RPT）</h3>
          <button
            className="btn-primary !py-1.5 !px-3 text-sm"
            onClick={addRpt}
            disabled={busy === "__addRpt" || hasActiveRpt}
            title={hasActiveRpt ? "すでに登録済みです" : undefined}
          >
            {busy === "__addRpt" ? "登録中..." : "＋ リタポを追加"}
          </button>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th className="w-12 text-right">No.</th>
              <th>月額</th>
              <th>状態</th>
              <th>開始</th>
              <th>停止</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rptContracts.map((x, i) => (
              <tr key={x.id}>
                <td className="text-right text-ink-mute tabular-nums">{i + 1}</td>
                <td>{formatYen(x.monthly_amount ?? rptMonthly)}</td>
                <td>{statusLabel(x.status)}</td>
                <td>{formatDate(x.started_at)}</td>
                <td>{x.canceled_at ? formatDate(x.canceled_at) : "—"}</td>
                <td className="text-right">
                  {x.status !== "canceled" && (
                    <button
                      className="btn-danger !py-1 !px-2 text-xs"
                      onClick={() => cancelRpt(x.id)}
                      disabled={busy === x.id}
                    >
                      停止
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rptContracts.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-ink-mute py-3">
                  リタポメンバーの登録はありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="text-xs text-ink-soft">
          既にStripe等で課金中の会員を「記録」として登録します。新たな決済は発生しません。月額合計には加算されず、特別参加タグ「リタポ」として表示されます。
        </p>
      </div>
    </div>
  );
}
