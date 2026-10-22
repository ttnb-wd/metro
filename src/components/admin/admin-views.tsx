import Link from "next/link";
import { ArrowRight, ArrowUpRight, Inbox } from "lucide-react";
import { randomUUID } from "node:crypto";
import { Button } from "@/components/ui/button";
import { PaymentRejectionForm, PaymentApprovalForm } from "./payment-review";
import { fulfilmentEnabled } from "@/server/commerce/config";
import { serviceConfigured } from "@/server/vpn/transport";
import type { AdminTable } from "@/server/admin/repository";
import { PrivateEvidencePreview } from "./private-evidence-preview";

export function AdminHeading({ eyebrow = "METRO / ADMINISTRATION", title, description }: { eyebrow?: string; title: string; description: string }) {
  return <div className="admin-heading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>;
}
export function AdminEmpty({ title, description }: { title: string; description: string }) {
  return <div className="admin-empty"><span className="admin-empty-icon"><Inbox size={25} strokeWidth={1.4} aria-hidden="true" /></span><h2>{title}</h2><p>{description}</p><Link href="/admin" className="text-link">Return to overview <ArrowRight size={15} aria-hidden="true" /></Link></div>;
}
export function AdminNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return <aside className="admin-notice"><strong>{title}</strong><p>{children}</p></aside>;
}
export function AdminRecords({ data, title }: { data: AdminTable; title: string }) {
  const url = (page: number) => `?${new URLSearchParams({ q: data.query, page: String(page) })}`;
  return <section className="admin-panel admin-records" aria-label={title}>
    <div className="admin-record-toolbar"><div><h2>{title}</h2><p>{data.total} {data.total === 1 ? "record" : "records"}</p></div><form method="get" role="search"><label htmlFor="admin-search" className="sr-only">Search by customer name or email</label><input id="admin-search" name="q" type="search" maxLength={80} defaultValue={data.query} placeholder="Customer name or email" /><Button variant="secondary" size="sm">Search</Button>{data.query && <Link href="?" className="text-link">Clear</Link>}</form></div>
    {!data.rows.length ? <AdminEmpty title={data.query ? "No matching records." : "Nothing here yet."} description={data.query ? "Try another customer name or email address." : "Records will appear here when real website activity is recorded."} /> : <div className="admin-table-wrap"><table className="admin-table"><caption className="sr-only">{title} · page {data.page}, 25 records per page</caption><thead><tr>{data.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{data.rows.map(row => <tr key={row.id}>{row.cells.map((cell, index) => <td key={index} data-label={data.columns[index]}>{index === 0 ? <div className="admin-first-cell">{row.href ? <Link href={row.href}>{cell}<ArrowUpRight size={13} aria-hidden="true" /></Link> : <span>{cell}</span>}{row.history && <details><summary>Issue & retry history ({row.history.length})</summary>{row.description && <p>{row.description}</p>}{row.history.length ? <ol>{row.history.map((event, i) => <li key={i}>{event}</li>)}</ol> : <p>No retry events recorded.</p>}</details>}{row.evidence && <PrivateEvidencePreview id={row.id} />}{row.rejectable && <details><summary>Review options</summary><PaymentApprovalForm evidenceId={row.id} requestKey={randomUUID()} enabled={fulfilmentEnabled() && serviceConfigured()} /><PaymentRejectionForm evidenceId={row.id} requestKey={randomUUID()} /></details>}</div> : cell}</td>)}</tr>)}</tbody></table></div>}
    <nav className="admin-pagination" aria-label="Record pagination"><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span><div>{data.page > 1 && <Link href={url(data.page - 1)}>Previous</Link>}{data.page * data.pageSize < data.total && <Link href={url(data.page + 1)}>Next</Link>}</div></nav>
  </section>;
}
