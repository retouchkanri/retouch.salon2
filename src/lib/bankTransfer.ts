/**
 * 銀行振込の振込先口座情報。実値は環境変数（.env.local / Vercel）で設定する。
 * 寄付の「銀行振込」確認ページ（/donate/thanks?method=bank）と、寄付者宛ての
 * 振込案内メールの両方で使う。未設定の項目は「（未設定）」として表示する。
 */
export type BankTransferInfo = {
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  accountHolder: string;
  /** 任意の補足（振込手数料のご負担のお願い等）。 */
  note: string | null;
  /** いずれか1つでも実値が設定されているか（未設定時の案内出し分け用）。 */
  configured: boolean;
};

const FALLBACK = "（未設定）";

export function getBankTransferInfo(): BankTransferInfo {
  const bankName = (process.env.BANK_TRANSFER_BANK_NAME || "").trim();
  const branchName = (process.env.BANK_TRANSFER_BRANCH || "").trim();
  const accountType = (process.env.BANK_TRANSFER_ACCOUNT_TYPE || "").trim();
  const accountNumber = (process.env.BANK_TRANSFER_ACCOUNT_NUMBER || "").trim();
  const accountHolder = (process.env.BANK_TRANSFER_ACCOUNT_HOLDER || "").trim();
  const note = (process.env.BANK_TRANSFER_NOTE || "").trim();

  return {
    bankName: bankName || FALLBACK,
    branchName: branchName || FALLBACK,
    accountType: accountType || "普通",
    accountNumber: accountNumber || FALLBACK,
    accountHolder: accountHolder || FALLBACK,
    note: note || null,
    configured: Boolean(bankName || accountNumber || accountHolder),
  };
}

/** メール本文などプレーンテキスト用の振込先ブロックを組み立てる。 */
export function bankTransferInfoText(info: BankTransferInfo): string {
  return (
    `【振込先口座】\n` +
    `　銀行名　： ${info.bankName}\n` +
    `　支店名　： ${info.branchName}\n` +
    `　口座種別： ${info.accountType}\n` +
    `　口座番号： ${info.accountNumber}\n` +
    (info.note ? `\n${info.note}\n` : "")
  );
}
