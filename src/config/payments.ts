// Website payment instructions explicitly supplied by the business owner.
// Keep this independent of Telegram configuration and historical order snapshots.
export const websiteKbzPay = {
  id: "mobile_wallet", // Retain the existing website method ID.
  name: "KBZPay (KPay)",
  accountName: "Shin Htet Maung",
  accountNumber: "09442416930",
} as const;
export const kbzPayQr = { src: "/payments/kbzpay-original.png", width: 498, height: 493 } as const;
export function matchesWebsiteKbzPay(method: { id: string; accountName: string; accountNumber: string }) {
  return method.id === websiteKbzPay.id && method.accountName === websiteKbzPay.accountName && method.accountNumber === websiteKbzPay.accountNumber;
}
