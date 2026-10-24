import "server-only";
import { notificationsEnabled } from "../notifications/policy";
import { z } from "zod";
import type { PrismaClient } from "../db/generated/client";
import { buildAdminAccess } from "./access";
import { FoundationError, type SessionReader } from "../owner/authorization";
import { entitlementSchema } from "../vpn/contracts";
import { formatWebsiteMmk } from "@/features/pricing/catalog";
import { formatMyanmarTime } from "@/lib/myanmar-time";
import { orderNumber } from "@/features/pricing/receipt";
import { paymentMethodSchema } from "../commerce/config";
import { currentProvisioning } from "@/features/pricing/order-status";

export type AdminRow = { id: string; cells: string[]; href?: string; history?: string[]; description?: string; rejectable?: boolean; evidence?: boolean; reviewedVersion?: number; reviewedSha256?: string };
export type AdminTable = { columns: string[]; rows: AdminRow[]; total: number; page: number; pageSize: number; query: string };
export const adminQuerySchema = z.object({ q: z.string().trim().max(80).default(""), page: z.coerce.number().int().min(1).max(10000).default(1) });
export type RecordSection = "customers" | "orders" | "payments" | "vpn" | "support" | "notifications" | "audit";
const date = formatMyanmarTime;
const label = (value: string) => /^[A-Z0-9_:.-]{1,100}$/.test(value) ? value.replaceAll("_", " ") : "Unavailable";
const gb = (value: string) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(BigInt(value)) / 1024 ** 3)} GB`;
const PAGE_SIZE = 25;
export function redactSupportDescription(value: string) {
  return value.slice(0, 1000).replace(/(?:ss|postgres(?:ql)?|https?):\/\/\S+/gi, "[private link redacted]")
    .replace(/bearer\s+\S+/gi, "[token redacted]").replace(/[A-Za-z0-9_+/=-]{32,}/g, "[private value redacted]");
}

export function buildAdminRepository(db: PrismaClient, readSession?: SessionReader) {
  const access = buildAdminAccess(db, readSession);
  return {
    async notificationDelivery() { return access(async ({ tx }) => {
      if (!notificationsEnabled()) return [];
      return tx.websiteNotification.findMany({ where: { emailState: { in: ["FAILED", "UNCERTAIN", "RETRY"] } }, take: 50, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, emailState: true, emailAttempts: true, emailErrorCode: true, createdAt: true, user: { select: { email: true } } } });
    }); },
    identity: () => access(async ({ account }) => account),
    async order(orderId: string) {
      if (!z.uuid().safeParse(orderId).success) throw new FoundationError("NOT_FOUND");
      return access(async ({ tx }) => {
        const row = await tx.websiteOrder.findUnique({ where: { id: orderId }, select: { id: true, userId: true, quoteSnapshot: true, totalMmk: true, version: true, state: true, payment: true, provisioning: true, createdAt: true, user: { select: { name: true, email: true } }, evidence: { orderBy: { createdAt: "desc" }, select: { id: true, sha256: true, createdAt: true, decisions: { select: { decision: true, createdAt: true, reasonCode: true } } } }, operations: { select: { id: true, state: true, version: true, kind: true } } } });
        if (!row) throw new FoundationError("NOT_FOUND");
        const plan = z.object({ packageName: z.string().max(80), durationDays: z.number().int().positive(), totalDataGb: z.number().int().positive(), pricingVersion: z.number().int().positive() }).safeParse(row.quoteSnapshot);
        const method = z.object({ paymentMethod: paymentMethodSchema }).safeParse(row.quoteSnapshot);
        const { quoteSnapshot, ...details } = row; void quoteSnapshot;
        return { ...details, provisioning: currentProvisioning(row, row.operations.find(operation => operation.kind === "PROVISION")?.state), paymentMethod: method.success ? method.data.paymentMethod : null, plan: plan.success ? plan.data : null, totalMmk: row.totalMmk.toFixed(0), evidence: row.evidence.map(file => ({ ...file, createdAt: file.createdAt.toISOString() })) };
      });
    },
    async service(serviceId: string) {
      if (!z.uuid().safeParse(serviceId).success) throw new FoundationError("NOT_FOUND");
      return access(async ({ tx }) => {
        const row = await tx.websiteServiceReference.findUnique({ where: { id: serviceId }, select: { id: true, userId: true, snapshot: true, capturedAt: true, user: { select: { name: true, email: true } } } });
        if (!row) throw new FoundationError("NOT_FOUND");
        const parsed = entitlementSchema.safeParse(row.snapshot);
        if (!parsed.success || parsed.data.owner.subject !== row.userId) throw new FoundationError("UNAVAILABLE");
        const orders = await tx.websiteOrder.findMany({ where: { userId: row.userId, state: "COMPLETE", payment: "CONFIRMED" }, select: { quoteSnapshot: true }, orderBy: { createdAt: "desc" }, take: 100 });
        const packageName = orders.map(order => z.object({ packageId: z.string(), packageName: z.string().max(80) }).safeParse(order.quoteSnapshot)).find(order => order.success && order.data.packageId === parsed.data.packageId);
        return { id: row.id, userId: row.userId, customer: row.user, packageName: packageName?.success ? packageName.data.packageName : "Secure Access", entitlement: parsed.data, capturedAt: row.capturedAt.toISOString() };
      });
    },
    async issue(issueId: string) {
      if (!z.uuid().safeParse(issueId).success) throw new FoundationError("NOT_FOUND");
      return access(async ({ tx }) => {
        const row = await tx.supportIssue.findUnique({ where: { id: issueId }, select: { id: true, userId: true, serviceId: true, version: true, state: true, attempts: true, description: true, events: { orderBy: { version: "asc" }, select: { id: true, kind: true, attempt: true, createdAt: true } } } });
        if (!row) throw new FoundationError("NOT_FOUND");
        return { ...row, description: redactSupportDescription(row.description), events: row.events.map(event => ({ ...event, createdAt: event.createdAt.toISOString() })) };
      });
    },
    reports: () => access(async ({ tx }) => {
      const packages = await tx.$queryRaw<Array<{ packageName: string; orders: bigint; total: string }>>`SELECT COALESCE("quoteSnapshot"->>'packageName','Historical package') AS "packageName",count(*) AS orders,sum("totalMmk")::text AS total FROM metro_website_order WHERE payment='CONFIRMED' GROUP BY 1 ORDER BY count(*) DESC`;
      const services = await tx.websiteServiceReference.findMany({ select: { snapshot: true, userId: true } });
      let used = BigInt(0), active = 0;
      for (const row of services) { const data = entitlementSchema.safeParse(row.snapshot); if (data.success && data.data.owner.subject === row.userId) { used += BigInt(data.data.usedBytes); if (data.data.status === "ACTIVE" && Date.parse(data.data.expiresAt) > Date.now()) active++; } }
      return { packages: packages.map(row => ({ packageName: row.packageName, orders: row.orders.toString(), total: row.total })), active, usedGb: (Number(used) / 1024 ** 3).toLocaleString("en-US", { maximumFractionDigits: 2 }) };
    }),
    overview: () => access(async ({ tx, account }) => {
      const customers = await tx.user.count({ where: { id: { not: account.id } } });
      const orders = await tx.websiteOrder.count();
      const pendingPayments = await tx.websiteOrder.count({ where: { payment: "UNDER_REVIEW" } });
      const services = await tx.websiteServiceReference.count();
      const openIssues = await tx.supportIssue.count({ where: { state: { notIn: ["RESOLVED", "CLOSED"] } } });
      const pendingEvents = await tx.websiteOutboxEvent.count({ where: { state: { not: "DELIVERED" } } });
      const confirmed = await tx.websiteOrder.aggregate({ where: { payment: "CONFIRMED" }, _sum: { totalMmk: true } });
      const queued = await tx.websiteOperation.count({ where: { state: { in: ["QUEUED", "RETRY_PENDING", "REVIEW_REQUIRED"] } } });
      const snapshots = await tx.websiteServiceReference.findMany({ select: { snapshot: true } });
      const activeServices = snapshots.filter(row => { const parsed = entitlementSchema.safeParse(row.snapshot); return parsed.success && parsed.data.status === "ACTIVE" && Date.parse(parsed.data.expiresAt) > Date.now(); }).length;
      return { customers, orders, pendingPayments, services, activeServices, openIssues, pendingEvents, confirmedMmk: confirmed._sum.totalMmk?.toFixed(0) ?? "0", queued };
    }),
    async records(section: RecordSection, input: unknown): Promise<AdminTable> {
      const parsed = adminQuerySchema.safeParse(input);
      if (!parsed.success) throw new FoundationError("INVALID_REQUEST");
      const { q, page } = parsed.data;
      return access(async ({ tx }) => {
        const pagination = { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE };
        const userFilter = q ? { OR: [{ email: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }] } : {};
        let columns: string[], rows: AdminRow[], total: number;
        switch (section) {
          case "customers": {
            const where = userFilter;
            const result = await tx.user.findMany({ where, ...pagination, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, name: true, email: true, emailVerified: true, createdAt: true, _count: { select: { websiteOrders: true, services: true } } } });
            total = await tx.user.count({ where }); columns = ["Customer", "Email", "Verification", "Orders / Services", "Joined"];
            rows = result.map(row => ({ id: row.id, href: `/admin/customers/${row.id}`, cells: [row.name, row.email, row.emailVerified ? "Verified" : "Unverified", `${row._count.websiteOrders} / ${row._count.services}`, date(row.createdAt)] })); break;
          }
          case "orders": {
            const where = { user: userFilter };
            const result = await tx.websiteOrder.findMany({ where, ...pagination, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, totalMmk: true, state: true, payment: true, provisioning: true, operations: { where: { kind: "PROVISION" }, take: 1, select: { state: true } }, createdAt: true, user: { select: { email: true } } } });
            total = await tx.websiteOrder.count({ where }); columns = ["Order", "Customer", "Original total", "Payment", "Fulfilment", "Created"];
            rows = result.map(row => ({ id: row.id, href: `/admin/orders/${row.id}`, cells: [orderNumber(row.id), row.user.email, formatWebsiteMmk(row.totalMmk.toFixed(0)), label(row.payment), `${label(row.state)} · ${label(currentProvisioning(row, row.operations[0]?.state))}`, date(row.createdAt)] })); break;
          }
          case "payments": {
            const where = { order: { user: userFilter } };
            const result = await tx.paymentEvidence.findMany({ where, ...pagination, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, sha256: true, mediaType: true, bytes: true, createdAt: true, order: { select: { id: true, quoteSnapshot: true, totalMmk: true, version: true, state: true, payment: true, provisioning: true, operations: { where: { kind: "PROVISION" }, take: 1, select: { state: true } }, user: { select: { name: true, email: true } } } }, decisions: { orderBy: { createdAt: "desc" }, take: 1, select: { decision: true, createdAt: true } } } });
            total = await tx.paymentEvidence.count({ where }); columns = ["Evidence / Order", "Customer", "Package / days", "Amount", "Payment method", "Submitted · Myanmar time", "Review / Fulfilment"];
            rows = result.map(row => {
              const plan = z.object({ packageName: z.string(), durationDays: z.number(), paymentMethod: paymentMethodSchema }).safeParse(row.order.quoteSnapshot);
              return { id: row.id, reviewedVersion: row.order.version, reviewedSha256: row.sha256, href: `/admin/orders/${row.order.id}`, evidence: true, rejectable: row.decisions.length === 0 && row.order.state === "AWAITING_PAYMENT" && row.order.payment === "UNDER_REVIEW", cells: [orderNumber(row.order.id), `${row.order.user.name} · ${row.order.user.email}`, plan.success ? `${plan.data.packageName} · ${plan.data.durationDays} days` : "Not recorded", formatWebsiteMmk(row.order.totalMmk.toFixed(0)), plan.success ? plan.data.paymentMethod.name : "Not recorded", date(row.createdAt), `${row.decisions[0] ? label(row.decisions[0].decision) : label(row.order.payment)} · ${label(currentProvisioning(row.order, row.order.operations[0]?.state))}`] };
            }); break;
          }
          case "vpn": {
            const where = { user: userFilter };
            const result = await tx.websiteServiceReference.findMany({ where, ...pagination, orderBy: [{ capturedAt: "desc" }, { id: "asc" }], select: { id: true, userId: true, snapshot: true, capturedAt: true, user: { select: { email: true } } } });
            total = await tx.websiteServiceReference.count({ where }); columns = ["Service reference", "Customer", "Recorded status", "Total / Used / Remaining", "Expiry", "Snapshot captured"];
            rows = result.map(row => {
              const parsed = entitlementSchema.safeParse(row.snapshot); const data = parsed.success && parsed.data.owner.subject === row.userId ? parsed.data : null;
              return { id: row.id, href: `/admin/vpn/${row.id}`, cells: [row.id, row.user.email, data ? label(data.status) : "Snapshot unavailable", data ? `${gb(data.totalBytes)} / ${gb(data.usedBytes)} / ${gb(data.remainingBytes)}` : "Unavailable", data ? date(new Date(data.expiresAt)) : "Unavailable", date(row.capturedAt)] };
            }); break;
          }
          case "support": {
            const where = { service: { user: userFilter } };
            const result = await tx.supportIssue.findMany({ where, ...pagination, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, description: true, category: true, state: true, attempts: true, createdAt: true, service: { select: { user: { select: { email: true } } } }, events: { orderBy: { version: "asc" }, select: { kind: true, attempt: true, createdAt: true } } } });
            total = await tx.supportIssue.count({ where }); columns = ["Issue", "Customer", "Category", "State", "Retries", "Reported"];
            rows = result.map(row => ({ id: row.id, href: `/admin/support/${row.id}`, description: redactSupportDescription(row.description), cells: [row.id, row.service.user.email, label(row.category), label(row.state), `${row.attempts} / 3`, date(row.createdAt)], history: row.events.map(event => `${date(event.createdAt)} · ${label(event.kind)} · attempt ${event.attempt}`) })); break;
          }
          case "notifications": {
            const where = { user: userFilter };
            const result = await tx.websiteOutboxEvent.findMany({ where, ...pagination, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, topic: true, resourceId: true, state: true, attempts: true, createdAt: true, operation: { select: { issueId: true } }, user: { select: { email: true } } } });
            total = await tx.websiteOutboxEvent.count({ where }); columns = ["Event", "Customer", "Processing state", "Delivery attempts", "Created"];
            rows = result.map(row => ({ id: row.id, href: row.topic === "WEBSITE_ISSUE_REPORTED" ? `/admin/support/${row.resourceId}` : row.topic === "VPN_FULFILMENT_REQUESTED" ? `/admin/orders/${row.resourceId}` : row.operation?.issueId ? `/admin/support/${row.operation.issueId}` : "/admin/support", cells: [label(row.topic), row.user.email, label(row.state), String(row.attempts), date(row.createdAt)] })); break;
          }
          case "audit": {
            const where = { target: userFilter };
            const result = await tx.websiteAuditEvent.findMany({ where, ...pagination, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, action: true, outcome: true, reasonCode: true, createdAt: true, actor: { select: { email: true } }, target: { select: { email: true } } } });
            total = await tx.websiteAuditEvent.count({ where }); columns = ["Action", "Actor", "Target", "Outcome", "Reason", "Recorded"];
            rows = result.map(row => ({ id: row.id, cells: [label(row.action), row.actor.email, row.target.email, label(row.outcome), label(row.reasonCode), date(row.createdAt)] })); break;
          }
        }
        return { columns, rows, total, page, pageSize: PAGE_SIZE, query: q };
      });
    },
    async customer(userId: string) {
      if (!z.uuid().safeParse(userId).success) throw new FoundationError("NOT_FOUND");
      return access(async ({ tx }) => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, emailVerified: true, createdAt: true, _count: { select: { websiteOrders: true, services: true } } } });
        if (!user) throw new FoundationError("NOT_FOUND");
        const references = await tx.websiteServiceReference.findMany({ where: { userId }, take: 50, select: { id: true, version: true, capturedAt: true } });
        return { ...user, createdAt: user.createdAt.toISOString(), references: references.map(row => ({ ...row, capturedAt: row.capturedAt.toISOString() })) };
      });
    },
    async paymentRejectionTarget(evidenceId: string) {
      if (!z.uuid().safeParse(evidenceId).success) throw new FoundationError("INVALID_REQUEST");
      return access(async ({ tx }) => {
        const evidence = await tx.paymentEvidence.findUnique({ where: { id: evidenceId }, select: { id: true, orderId: true, userId: true, sha256: true, order: { select: { totalMmk: true, version: true } } } });
        if (!evidence) throw new FoundationError("NOT_FOUND");
        return { evidenceId: evidence.id, orderId: evidence.orderId, userId: evidence.userId, amountMmk: evidence.order.totalMmk.toFixed(0), reviewedVersion: evidence.order.version, reviewedSha256: evidence.sha256 };
      }, true);
    },
  };
}
