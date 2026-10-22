export const adminSections = [
  { slug: "", label: "Overview", group: "WORKSPACE", description: "A clear view of your website and the work that needs attention." },
  { slug: "customers", label: "Customers", group: "WORKSPACE", description: "Real Metro accounts and their website service references." },
  { slug: "plans", label: "Plans & Pricing", group: "COMMERCE", description: "Publish independent website packages. Existing orders keep their original price." },
  { slug: "discounts", label: "Discounts", group: "COMMERCE", description: "Control availability and discounts for each 30-day subscription duration." },
  { slug: "orders", label: "Orders", group: "COMMERCE", description: "Website orders, payment review and fulfilment progress." },
  { slug: "payments", label: "Payment Approvals", group: "COMMERCE", description: "Review private evidence against actual business payments and track fulfilment." },
  { slug: "vpn", label: "VPN Management", group: "OPERATIONS", description: "Website entitlements, quota, expiry and controlled credential access." },
  { slug: "support", label: "Support & Complaints", group: "OPERATIONS", description: "Customer issues and the history of their troubleshooting attempts." },
  { slug: "notifications", label: "Notifications", group: "OPERATIONS", description: "Durable website events awaiting processing. This is an event queue, not a delivery receipt." },
  { slug: "reports", label: "Reports", group: "WORKSPACE", description: "Current website records, with confirmed amounts separated from unverified orders." },
  { slug: "settings", label: "Settings", group: "ACCOUNT", description: "Your verified OWNER identity and website integration readiness." },
  { slug: "audit", label: "Audit History", group: "ACCOUNT", description: "Append-only records of authorized OWNER operations." },
] as const;
export type AdminSection = typeof adminSections[number]["slug"];
export const adminHref = (slug: string) => slug ? `/admin/${slug}` : "/admin";
