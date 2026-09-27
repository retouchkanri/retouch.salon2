import Image from "next/image";
import bgLoginImage from "@/assets/images/bg-login.png";

export default function AuthPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <Image
        src={bgLoginImage}
        alt=""
        fill
        priority
        sizes="100vw"
        className="absolute inset-0 z-0 object-cover opacity-60"
        aria-hidden
      />
      <main className="relative z-10 flex flex-1 items-center justify-center px-2 py-3 sm:p-4 md:justify-end md:pr-10 lg:pr-16 xl:pr-24">
        <div className="auth-page w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
