/** 公開のお問い合わせ先。フォームの転送先もここへ揃える。 */
export const PUBLIC_CONTACT_EMAIL = "info@retouch.salon";

const OLD_CONTACT_EMAILS = [/support@retouch-members\.com/gi, /info@retouch-members\.com/gi];

export function withCurrentContactEmail(text: string): string {
  return OLD_CONTACT_EMAILS.reduce((next, pattern) => next.replace(pattern, PUBLIC_CONTACT_EMAIL), text);
}

/** 挨拶だけの発話か。質問が続いている場合は false。 */
export function isGreetingOnly(input: string): boolean {
  const core = input
    .trim()
    .replace(/[！!。．、,.\s　〜~ー♪☆★]/g, "")
    .toLowerCase();
  return /^(こんにちは|こんばんは|おはよう|おはようございます|はじめまして|初めまして|よろしく|よろしくお願いします|hello|hi|hey|やあ|どうも|お疲れさま|お疲れ様|お疲れ様です)$/.test(
    core,
  );
}

export function fallbackChatReply(input: string): string {
  const t = input.trim();
  const folded = t.toLowerCase();
  if (isGreetingOnly(t)) {
    return "こんにちは。Retouchサポートです。こちらは、引退した競走馬のこれからの暮らしを、会員の方と一緒に支えている団体です。会員登録、馬への支援、見学会、寄付のことなど、知りたいことがあれば、今の言葉のまま聞いてくださいね。";
  }
  if (/会員|登録|入会/.test(t)) {
    return "会員登録は無料です。トップページの「新規会員登録」から、お名前とご連絡先を入れて進められます。登録のあと、マイページで支援の状況を見られます。途中で分からなくなったら、そのまま聞いてください。";
  }
  if (/寄付|支援|donation/.test(folded)) {
    return "支援には、その場かぎり寄付と、気になる馬を毎月支える一口支援があります。寄付はトップページの単発寄付から、毎月の支援は会員登録のあとマイページからお手続きいただけます。どの形が近いか、教えていただければご案内します。";
  }
  if (/退会|解約|キャンセル/.test(t)) {
    return "退会や支援の停止は、マイページのアカウント設定からお手続きいただけます。画面の場所が分からないときは、どこまで進んだか教えてください。";
  }
  if (/馬|horse/.test(folded)) {
    return "馬ごとの近況や支援の空きは、サイトの「馬ごとの支援状況」と、ログイン後のマイページで見られます。気になる馬の名前があれば、それを教えてください。";
  }
  if (/料金|プラン|会費|fee|price/.test(folded)) {
    return "会員の月額や一口支援の金額は、プランによって違います。最新の金額は会員登録後のマイページで確認できます。どのプランを比べたいか教えていただければ、違いを整理します。";
  }
  if (/問い合わせ|連絡|メール|contact/.test(folded)) {
    return `お問い合わせは、このページのフォームか ${PUBLIC_CONTACT_EMAIL} で受けています。営業日にご返信します。用件を一言いただけると、担当が読みやすいです。`;
  }
  if (/ありがとう|thank/.test(folded)) {
    return "こちらこそ、ありがとうございます。ほかに気になっていることがあれば、続けて聞いてください。";
  }
  return `ご質問ありがとうございます。分かる範囲でご案内しますので、もう少し具体的に教えていただけますか。メールで残したい場合は ${PUBLIC_CONTACT_EMAIL} か、お問い合わせフォームをご利用ください。`;
}
