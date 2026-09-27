import Link from "next/link";

export default function DonateThanksPage() {
  return (
    <div className="card text-center space-y-3">
      <p className="text-2xl">💚</p>
      <h1 className="text-xl font-bold">ご寄付をお預かりしました</h1>
      <p className="text-ink-soft">
        ご寄付ありがとうございました。受付が完了しました。<br />
        確認メールをお送りしておりますので、ご確認ください。
      </p>
      <Link href="/mypage" className="btn-primary inline-block mt-3">マイページへ戻る</Link>
    </div>
  );
}
