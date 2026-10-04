import withPWA from "@ducanh2912/next-pwa";

/** @type {import('next').NextConfig} */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const siteHost = (() => {
  try {
    return new URL(siteUrl).host;
  } catch {
    return "localhost:3000";
  }
})();

const nextConfig = {
  reactStrictMode: true,
  optimizeFonts: false,
  // 公開（ポート3000）は .next、修正用（ポート3001）は .next-dev。
  // 同じ出力先を共有すると、修正中の再コンパイルで公開側が落ちる。
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Typecheck + lint run via `prebuild` (tsc + next lint) so the build
  // worker pool does not OOM on memory-constrained Windows hosts.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  experimental: {
    cpus: 1,
    serverActions: {
      allowedOrigins: Array.from(
        new Set(["localhost:3000", "localhost:3001", "retouch.salon", "www.retouch.salon", siteHost]),
      ),
    },
  },
  // 絵文字画像（ファイル名＝コードポイントで内容は変わらない）はブラウザに長くキャッシュさせる
  async headers() {
    return [
      {
        source: "/noprecache/emoji/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
    ];
  },
  images: {
    // 数MBのPNGを /_next/image で変換すると、この環境では
    // 「Unable to optimize image」と digest の TypeError が出て表示が壊れる。
    // 元画像をそのまま配信する。
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "retouch-members.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // Keep the dev file-watcher away from huge non-source trees. An
      // extracted `horseimage/` archive (tens of thousands of large image
      // files) would otherwise be crawled and snapshotted by webpack,
      // which OOMs the compiler and can corrupt the .next pack cache
      // (the "Array buffer allocation failed" gunzip crash on restart).
      config.watchOptions = {
        ...(config.watchOptions || {}),
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/.next/**",
          "**/.next-dev/**",
          "**/.next-prod/**",
          "**/horseimage/**",
          "**/backups/**",
        ],
      };
    }
    return config;
  },
};

export default withPWA({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
  },
})(nextConfig);
