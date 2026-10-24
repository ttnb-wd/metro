import type { NextConfig } from "next";
import { browserProtectionHeaders } from "./src/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: [...browserProtectionHeaders,
      ...(process.env.NODE_ENV === "production" && process.env.BETTER_AUTH_URL?.startsWith("https://")
        ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
    ] }];
  },
  logging: { incomingRequests: { ignore: [/\/api\/auth/, /\/verify-email/] } },
};

export default nextConfig;
