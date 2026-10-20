export const site = {
  name: "Metro",
  description: "Discover and manage digital services with Metro. Start with Secure Access VPN, with more services to follow.",
};

export const publicNavigation = [
  { href: "/services", label: "Services" },
  { href: "/plans", label: "Plans" },
];

export const dashboardNavigation = [
  { href: "/dashboard", label: "Overview", icon: "overview" },
  { href: "/dashboard/services", label: "My services", icon: "services" },
  { href: "/dashboard/secure-access", label: "Secure Access", icon: "access" },
  { href: "/dashboard/orders", label: "Orders", icon: "orders" },
  { href: "/dashboard/billing", label: "Billing", icon: "billing" },
  { href: "/dashboard/settings", label: "Settings", icon: "settings" },
] as const;
