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
  // Typecheck + lint run via `prebuild` (tsc + next lint) so the build
  // worker pool does not OOM on memory-constrained Windows hosts.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  experimental: {
    cpus: 1,
    serverActions: {
      allowedOrigins: Array.from(new Set(["localhost:3000", siteHost])),
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
