import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const isolationHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

const nextConfig: NextConfig = {
  // Static export is production-only: `headers()` is unsupported with
  // `output: "export"`, but local `next dev` needs COOP/COEP so the threaded
  // OR-Tools WASM workers can use SharedArrayBuffer.
  ...(isProd ? { output: "export" as const } : {}),
  images: {
    unoptimized: true,
  },
  ...(!isProd
    ? {
        async headers() {
          return [
            {
              source: "/:path*",
              headers: isolationHeaders,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
