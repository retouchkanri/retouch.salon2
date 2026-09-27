import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import CommunityApp from "@/components/community/CommunityApp";
import { getSession } from "@/lib/auth";
import { normalizeInit } from "@/lib/community/api";
import { formatDate } from "@/lib/format";
import { isStaffRole } from "@/lib/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "コミュニティ",
  robots: { index: false, follow: false },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pickUuid(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && UUID_RE.test(s) ? s.toLowerCase() : null;
}

function Notice({ title, children, back }: { title: string; children: React.ReactNode; back: string }) {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="card max-w-md w-full text-center space-y-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-96.png" alt="" className="mx-auto h-14 w-14 rounded-[12px]" />
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="text-sm text-ink-soft space-y-2">{children}</div>
        <Link href={back} className="btn-secondary !px-5 !py-2 text-sm inline-flex">
          戻る
        </Link>
      </div>
    </div>
  );
}

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: { c?: string | string[]; dm?: string | string[]; m?: string | string[] };
}) {
  const requested = pickUuid(searchParams.c);
  // 前回開いていたチャンネル（無ければ既定のチャンネル）の内容まで、1回の呼び出しでまとめて取得する
  const remembered = pickUuid(cookies().get("community_last")?.value);
  const supabase = createSupabaseServerClient();
  const [session, initRes] = await Promise.all([
    getSession(),
    supabase.rpc("community_init", { p_channel: requested ?? remembered }),
  ]);
  if (!session) redirect(`/login?next=${encodeURIComponent("/community")}`);
  const staff = isStaffRole(session.role);
  const back = staff ? "/admin" : "/mypage";

  if (initRes.error || !initRes.data) {
    return (
      <Notice title="コミュニティを読み込めませんでした" back={back}>
        {staff ? (
          <p>
            データベースの更新が済んでいない可能性があります。Supabase の SQL Editor で
            <code className="bg-surface-soft px-1 rounded mx-1">supabase/community.sql</code>
            を実行してから、もう一度開いてください。
          </p>
        ) : (
          <p>時間をおいてから、もう一度お試しください。</p>
        )}
      </Notice>
    );
  }

  const init = normalizeInit(initRes.data);
  if (!init.is_member) {
    if (init.ban) {
      return (
        <Notice title="コミュニティのご利用を停止しています" back={back}>
          <p>運営の判断により、現在コミュニティをご利用いただけません。</p>
          {init.ban.until && <p>停止期間: {formatDate(init.ban.until, true)} まで</p>}
          <p>ご不明な点は運営までお問い合わせください。</p>
        </Notice>
      );
    }
    return (
      <Notice title="コミュニティをご利用いただけません" back={back}>
        <p>コミュニティは Retouch 会員の方がご利用いただけます。</p>
        <p>会員登録の手続き中の方は、登録完了後にご利用ください。</p>
      </Notice>
    );
  }

  return (
    <CommunityApp
      init={init}
      explicitChannel={!!requested && init.channel_id === requested}
      initialDmUserId={pickUuid(searchParams.dm)}
      initialMessageId={pickUuid(searchParams.m)}
    />
  );
}
