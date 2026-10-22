"use client";
import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { kbzPayQr, matchesWebsiteKbzPay } from "@/config/payments";
import { formatWebsiteMmk } from "@/features/pricing/catalog";
import type { PaymentMethod } from "@/server/commerce/config";

export function PaymentInstructions({ method, totalMmk, orderId, compact = false }: { method: PaymentMethod; totalMmk: string; orderId?: string; compact?: boolean }) {
  const [copyStatus, setCopyStatus] = useState("");
  if (compact) return <section className="checkout-card checkout-payment-panel" aria-label="KBZPay payment instructions">
    <h2>{matchesWebsiteKbzPay(method) ? "KBZPay (KPay)" : method.name}</h2>
    <div className="checkout-payment-body">
      {matchesWebsiteKbzPay(method) && <figure><Image src={kbzPayQr.src} width={kbzPayQr.width} height={kbzPayQr.height} alt="Original Metro KBZPay payment QR" unoptimized /><figcaption><a href={kbzPayQr.src} download="metro-kbzpay-qr.png" className="text-link">Download QR</a></figcaption></figure>}
      <div className="checkout-recipient"><dl><div><dt>Account name</dt><dd>{method.accountName}</dd></div><div><dt>Phone number</dt><dd className="payment-phone">{method.accountNumber}</dd></div></dl><Button type="button" variant="secondary" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(method.accountNumber); setCopyStatus("Number copied."); } catch { setCopyStatus("Select and copy the number above."); } }}>Copy Number</Button><p className="checkout-help">Scan the QR or transfer to this number. Confirm the recipient and pay the exact total shown above.</p>{copyStatus && <p role="status" className="checkout-help">{copyStatus}</p>}</div>
    </div>
  </section>;
  return <section className="payment-instructions" aria-label="Payment instructions">
    <h3>{matchesWebsiteKbzPay(method) ? "KBZPay (KPay)" : method.name}</h3>
    <dl className="payment-recipient"><div><dt>Account name</dt><dd>{method.accountName}</dd></div><div><dt>Payment phone number</dt><dd><span className="payment-phone">{method.accountNumber}</span><Button type="button" variant="secondary" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(method.accountNumber); setCopyStatus("Payment phone number copied."); } catch { setCopyStatus("Copy is unavailable. Select and copy the phone number above."); } }}>Copy phone number</Button></dd></div><div><dt>{orderId ? "Exact order amount" : "Quote amount"}</dt><dd className="payment-total">{formatWebsiteMmk(totalMmk)}</dd></div></dl>
    {copyStatus && <p role="status">{copyStatus}</p>}
    {matchesWebsiteKbzPay(method) && <figure className="payment-qr"><Image src={kbzPayQr.src} width={kbzPayQr.width} height={kbzPayQr.height} alt="Original KBZPay payment QR supplied by Metro. Confirm the recipient in KBZPay before sending." unoptimized /><figcaption><a href={kbzPayQr.src} download="metro-kbzpay-qr.png" className="text-link">Save / download original QR</a></figcaption></figure>}
    {orderId ? <><ol className="commerce-steps"><li>Scan this QR in KBZPay, or save the image and use KBZPay’s gallery scan if available. You can also transfer to the phone number above.</li><li>Check that the recipient is {method.accountName} and the phone number is {method.accountNumber}. If they differ, stop before sending.</li><li>Enter exactly {formatWebsiteMmk(totalMmk)}. Add your order reference in the note when supported.</li><li>Save the receipt and submit it below. Metro reviews the receiving account before confirming payment.</li></ol><p className="payment-reference">Order reference: <strong>{orderId}</strong></p><p>Pay this order only once. Uploading proof does not confirm payment. VPN activation follows verified payment approval.</p></> : <p>Place your order below before sending money. Your order page will keep these payment details and the agreed amount, with a private receipt upload.</p>}
  </section>;
}
