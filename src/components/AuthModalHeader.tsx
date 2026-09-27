import Image from "next/image";
import loginLogo from "@/assets/images/loginlogo.png";

export function AuthDivider() {
  return (
    <div className="my-5 border-t border-surface-line" aria-hidden="true" />
  );
}

export default function AuthModalHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div className="text-center">
      <div className="flex justify-center mb-3">
        <Image
          src={loginLogo}
          alt="Retouch"
          width={220}
          height={80}
          className="h-16 w-auto object-contain"
          priority
        />
      </div>
      <h1 className="text-2xl font-serif font-bold text-brand tracking-[0.15em]">RETOUCH</h1>
      <p className="text-sm text-ink-soft mt-1">{subtitle ?? "引退競走馬支援プラットフォーム"}</p>
      <AuthDivider />
    </div>
  );
}
