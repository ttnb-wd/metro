export type ServiceDefinition = {
  id: string;
  name: string;
  category: string;
  description: string;
  href: string;
  plansHref: string;
  availability: "available";
};

export const secureAccess: ServiceDefinition = {
  id: "secure-access",
  name: "Secure Access",
  category: "VPN",
  description: "VPN access through Outline Client, with data packages and flexible durations. Order online, submit payment proof and manage your service from your Metro account.",
  href: "/services/secure-access",
  plansHref: "/plans",
  availability: "available",
};

// Only real services belong here. Future entries can reuse the catalog UI.
export const services: readonly ServiceDefinition[] = [secureAccess];

export const outlineLinks = {
  download: "https://getoutline.org/get-started/",
  requirements: "https://support.getoutline.org/client/getting-started/system-requirements/",
  connecting: "https://support.getoutline.org/client/getting-started/connecting-device/",
};

export const outlinePlatforms = [
  { name: "Android", requirement: "Android 10+", type: "mobile" },
  { name: "iOS", requirement: "iOS 15.5+", type: "mobile" },
  { name: "Windows", requirement: "Windows 10+", type: "desktop" },
  { name: "macOS", requirement: "macOS 12.0+", type: "desktop" },
  { name: "Linux", requirement: "Ubuntu 20.04+", type: "desktop" },
] as const;
