import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  // PGlite on WASM-paketti, jota ei saa niputtaa palvelinkoodiin.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Tiedotteen PDF-liite lähetetään server actionilla (enintään 4 Mt, Vercelin raja 4,5 Mt).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  outputFileTracingIncludes: {
    "/**": ["./supabase/migrations/**"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
