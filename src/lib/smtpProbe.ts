import net from "node:net";
import tls from "node:tls";

/**
 * SMTP 疎通プローブ（メールは1通も送らない）。
 *
 * なぜ nodemailer の verify() では不十分か:
 *   verify() は「接続 + AUTH」までしか行わない。しかし 2026-08-09 の配信障害では
 *   AUTH は成功したうえで RCPT TO の段階で
 *     554 5.7.1 <ec2-...amazonaws.com[...]>: Client host rejected: Access denied
 *   と拒否されていた（Xserver の国外IPアクセス制限が Vercel の米国IPを弾いた）。
 *   Postfix は smtpd_delay_reject=yes（既定）のため、接続元IPの拒否も RCPT TO まで
 *   遅延して報告される。したがって verify() は「OK」を返してしまう。
 *
 *   このプローブは MAIL FROM → RCPT TO まで進めてから RSET で中断する。
 *   DATA を送らないので、メールは一切送信されない。
 */

export type SmtpProbeStep =
  | "connect"
  | "greeting"
  | "ehlo"
  | "starttls"
  | "ehlo_tls"
  | "auth"
  | "mail_from"
  | "rcpt_to"
  | "reset"
  | "quit";

export type SmtpProbeStage = {
  step: SmtpProbeStep;
  /** 送信したコマンド（認証情報はマスク済み）。 */
  command: string | null;
  code: number | null;
  response: string;
  ok: boolean;
};

export type SmtpProbeResult = {
  ok: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  mailFrom: string | null;
  rcptTo: string | null;
  stages: SmtpProbeStage[];
  failedAt: SmtpProbeStep | null;
  error: string | null;
  /** 日本語の原因推定。管理画面にそのまま表示する。 */
  hint: string | null;
  durationMs: number;
};

const CMD_TIMEOUT_MS = 15_000;

/** 応答が完結しているか（複数行応答は "250-" が続き "250 " で終わる）。 */
function completeResponseLength(buf: string): number {
  let offset = 0;
  for (;;) {
    const nl = buf.indexOf("\r\n", offset);
    if (nl < 0) return -1;
    const line = buf.slice(offset, nl);
    offset = nl + 2;
    // "250 xxx" は終端、"250-xxx" は継続
    if (/^\d{3}(?: |$)/.test(line)) return offset;
    if (!/^\d{3}-/.test(line)) return offset; // 想定外の行はそこで打ち切る
  }
}

type Conversation = {
  send: (cmd: string) => Promise<{ code: number | null; response: string }>;
  read: () => Promise<{ code: number | null; response: string }>;
  socket: () => net.Socket | tls.TLSSocket;
  swap: (s: tls.TLSSocket) => void;
  close: () => void;
};

function attach(initial: net.Socket | tls.TLSSocket): Conversation {
  let sock: net.Socket | tls.TLSSocket = initial;
  let buf = "";
  let pending: {
    resolve: (v: { code: number | null; response: string }) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  let fatal: Error | null = null;

  const flush = () => {
    if (!pending) return;
    const len = completeResponseLength(buf);
    if (len < 0) return;
    const raw = buf.slice(0, len);
    buf = buf.slice(len);
    const p = pending;
    pending = null;
    clearTimeout(p.timer);
    const text = raw.trim();
    const m = text.match(/^(\d{3})/);
    p.resolve({ code: m ? Number(m[1]) : null, response: text });
  };

  const fail = (e: Error) => {
    fatal = e;
    if (pending) {
      const p = pending;
      pending = null;
      clearTimeout(p.timer);
      p.reject(e);
    }
  };

  const bind = (s: net.Socket | tls.TLSSocket) => {
    s.setEncoding("utf8");
    s.on("data", (c: string) => {
      buf += c;
      flush();
    });
    s.on("error", (e: Error) => fail(e));
    s.on("close", () => fail(new Error("connection closed by server")));
  };
  bind(sock);

  const read = () =>
    new Promise<{ code: number | null; response: string }>((resolve, reject) => {
      if (fatal) return reject(fatal);
      const timer = setTimeout(() => {
        pending = null;
        reject(new Error("timeout waiting for server response"));
      }, CMD_TIMEOUT_MS);
      pending = { resolve, reject, timer };
      flush();
    });

  return {
    read,
    send: (cmd: string) => {
      if (fatal) return Promise.reject(fatal);
      sock.write(cmd + "\r\n");
      return read();
    },
    socket: () => sock,
    swap: (s: tls.TLSSocket) => {
      buf = "";
      sock = s;
      bind(s);
    },
    close: () => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
    },
  };
}

function hintFor(stage: SmtpProbeStage | null, egressNote: string): string | null {
  if (!stage) return null;
  const r = stage.response;
  if (/client host rejected|access denied/i.test(r)) {
    return (
      `送信元サーバーのIPアドレスがメールサーバー側で拒否されています。${egressNote}` +
      `Xserver の「国外IPアクセス制限設定」→「メール」で対象ドメインの制限を解除するか、` +
      `送信元を日本国内リージョン（Vercel: hnd1／東京）に固定してください。`
    );
  }
  if (/relay(ing)? (access )?denied/i.test(r)) {
    return "中継（リレー）が許可されていません。SMTP 認証が有効か、SMTP_USER/SMTP_PASS が正しいかご確認ください。";
  }
  if (/sender address rejected/i.test(r)) {
    return "MAIL FROM（差出人）が拒否されました。MAIL_FROM と SMTP_USER が同一メールボックスか確認してください。";
  }
  if (stage.step === "auth") {
    return "SMTP 認証に失敗しました。SMTP_USER / SMTP_PASS を確認してください（メールアドレス全体がユーザー名です）。";
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(r)) {
    return `SMTP_HOST（${process.env.SMTP_HOST ?? "未設定"}）の名前解決に失敗しました。サーバー名の綴りをご確認ください（Xserver のサーバー番号は管理パネルで確認できます）。`;
  }
  if (/timeout|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|closed/i.test(r)) {
    return "メールサーバーへ接続できません。SMTP_HOST / SMTP_PORT と、送信元からの 465/587 番ポートの疎通を確認してください。";
  }
  return null;
}

/**
 * SMTP の接続〜RCPT TO までを検証する。DATA は送らないためメールは送信されない。
 *
 * @param opts.rcptTo 検証に使う宛先。既定は MAIL_FROM（自ドメイン宛なので第三者に影響しない）。
 *                    外部ドメインを渡すとリレー許可まで検証できる。
 * @param opts.egressNote hint に差し込む送信元IPの説明文。
 */
export async function probeSmtpRelay(
  opts: { rcptTo?: string; egressNote?: string } = {},
): Promise<SmtpProbeResult> {
  const started = Date.now();
  const host = process.env.SMTP_HOST ?? "";
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASS ?? "";
  const port = Number(process.env.SMTP_PORT ?? 465) || 465;
  const secure = (process.env.SMTP_SECURE ?? "true").toLowerCase() !== "false";
  const mailFrom = (process.env.MAIL_FROM ?? user ?? "").replace(/^.*<([^>]+)>.*$/, "$1").trim();
  const rcptTo = opts.rcptTo?.trim() || mailFrom;
  const egressNote = opts.egressNote ?? "";

  const stages: SmtpProbeStage[] = [];
  const base = {
    host,
    port,
    secure,
    user: user || null,
    mailFrom: mailFrom || null,
    rcptTo: rcptTo || null,
  };

  if (!host || !user || !pass) {
    return {
      ...base,
      ok: false,
      stages,
      failedAt: "connect",
      error: "SMTP_HOST / SMTP_USER / SMTP_PASS が未設定です",
      hint: "Vercel の環境変数に SMTP_* が設定されているか確認してください。",
      durationMs: Date.now() - started,
    };
  }

  let convo: Conversation | null = null;
  let failedAt: SmtpProbeStep | null = null;

  const record = (
    step: SmtpProbeStep,
    command: string | null,
    res: { code: number | null; response: string },
    expect: (c: number | null) => boolean,
  ): boolean => {
    const ok = expect(res.code);
    stages.push({ step, command, code: res.code, response: res.response, ok });
    if (!ok && !failedAt) failedAt = step;
    return ok;
  };

  try {
    // --- connect -----------------------------------------------------------
    const sock = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("connection timeout")), CMD_TIMEOUT_MS);
      const s = secure
        ? tls.connect({ host, port, servername: host }, () => {
            clearTimeout(timer);
            resolve(s);
          })
        : net.connect({ host, port }, () => {
            clearTimeout(timer);
            resolve(s);
          });
      s.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    stages.push({
      step: "connect",
      command: null,
      code: null,
      response: `connected to ${host}:${port} (${secure ? "implicit TLS" : "plaintext"})`,
      ok: true,
    });
    convo = attach(sock);

    // --- greeting ----------------------------------------------------------
    if (!record("greeting", null, await convo.read(), (c) => c === 220)) throw new Error("bad greeting");

    // --- EHLO --------------------------------------------------------------
    const ehloName = "retouch-members.probe";
    if (!record("ehlo", `EHLO ${ehloName}`, await convo.send(`EHLO ${ehloName}`), (c) => c === 250))
      throw new Error("EHLO rejected");

    // --- STARTTLS (587 等の平文ポート時のみ) --------------------------------
    if (!secure) {
      if (!record("starttls", "STARTTLS", await convo.send("STARTTLS"), (c) => c === 220))
        throw new Error("STARTTLS rejected");
      const plain = convo.socket();
      plain.removeAllListeners("data");
      plain.removeAllListeners("close");
      plain.removeAllListeners("error");
      const upgraded = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const t = tls.connect({ socket: plain as net.Socket, servername: host }, () => resolve(t));
        t.once("error", reject);
      });
      convo.swap(upgraded);
      if (!record("ehlo_tls", `EHLO ${ehloName}`, await convo.send(`EHLO ${ehloName}`), (c) => c === 250))
        throw new Error("EHLO after STARTTLS rejected");
    }

    // --- AUTH --------------------------------------------------------------
    const token = Buffer.from(`\0${user}\0${pass}`).toString("base64");
    if (!record("auth", "AUTH PLAIN ********", await convo.send(`AUTH PLAIN ${token}`), (c) => c === 235))
      throw new Error("authentication failed");

    // --- MAIL FROM ---------------------------------------------------------
    if (
      !record(
        "mail_from",
        `MAIL FROM:<${mailFrom}>`,
        await convo.send(`MAIL FROM:<${mailFrom}>`),
        (c) => c === 250,
      )
    ) {
      throw new Error("MAIL FROM rejected");
    }

    // --- RCPT TO（ここで接続元IPの拒否が表面化する） -------------------------
    if (
      !record("rcpt_to", `RCPT TO:<${rcptTo}>`, await convo.send(`RCPT TO:<${rcptTo}>`), (c) =>
        c === 250 || c === 251,
      )
    ) {
      throw new Error("RCPT TO rejected");
    }

    // --- RSET（DATA を送らず中断＝メールは送信されない） ---------------------
    record("reset", "RSET", await convo.send("RSET"), (c) => c === 250);
    try {
      record("quit", "QUIT", await convo.send("QUIT"), (c) => c === 221);
    } catch {
      // QUIT 応答前に切断されても検証結果には影響しない
    }
    convo.close();

    const failedStage = stages.find((s) => !s.ok) ?? null;
    return {
      ...base,
      ok: !failedStage,
      stages,
      failedAt,
      error: null,
      hint: failedStage ? hintFor(failedStage, egressNote) : null,
      durationMs: Date.now() - started,
    };
  } catch (e: any) {
    convo?.close();
    const failedStage = stages.find((s) => !s.ok) ?? null;
    const message = e?.message ?? "smtp probe failed";
    if (!failedAt) failedAt = (stages[stages.length - 1]?.step ?? "connect") as SmtpProbeStep;
    return {
      ...base,
      ok: false,
      stages,
      failedAt,
      error: failedStage ? `${message}: ${failedStage.response}` : message,
      hint: hintFor(failedStage ?? { step: failedAt, command: null, code: null, response: message, ok: false }, egressNote),
      durationMs: Date.now() - started,
    };
  }
}
