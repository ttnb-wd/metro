import type { NextConfig } from "next";
import { browserProtectionHeaders } from "./src/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  ...(process.env.METRO_STANDALONE_BUILD === "true" ? { output: "standalone" as const } : {}),
  async headers() {
    return [{ source: "/:path*", headers: [...browserProtectionHeaders,
      ...(process.env.NODE_ENV === "production" && (process.env.METRO_HTTPS_ONLY === "true" || process.env.BETTER_AUTH_URL?.startsWith("https://"))
        ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
    ] }];
  },
  logging: { incomingRequests: { ignore: [/\/api\/auth/, /\/verify-email/, /\/reset-password/] } },
};

export default nextConfig;
