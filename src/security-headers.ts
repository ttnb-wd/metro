/** Shared with proxy and configuration; contains no server credentials. */
export function contentSecurityPolicy(nonce: string, development: boolean, https: boolean) {
  return [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Motion and theme transitions use inline style attributes, never scripts.
    "style-src 'self' 'unsafe-inline'", "img-src 'self' blob: data:", "font-src 'self'",
    `connect-src 'self'${development ? " ws: wss:" : ""}`, "object-src 'none'", "base-uri 'self'",
    "form-action 'self'", "frame-ancestors 'none'", ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
export const browserProtectionHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];
