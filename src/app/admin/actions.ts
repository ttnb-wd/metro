"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPricingRepository } from "@/server/pricing";
import { getAdminRepository } from "@/server/admin";
import { getWebsiteRepositories } from "@/server/website";
import { adminErrorMessage, assertAdminOrigin } from "@/server/admin/request";
import { FoundationError } from "@/server/owner/authorization";
import type { AdminActionState } from "@/features/pricing/action-state";
import { createHash } from "node:crypto";
import { fulfilmentEnabled } from "@/server/commerce/config";
import { serviceConfigured } from "@/server/vpn/transport";
import { callVpnService } from "@/server/vpn/transport";
import { importedCatalog } from "@/server/commerce/catalog-import";
import { liveServiceStatus } from "@/server/vpn/live-status";
import { rejectionReasonSchema } from "@/features/pricing/payment-review";

export async function retryFulfilment(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  try {
    assertAdminOrigin(await headers());
    if (!fulfilmentEnabled() || !serviceConfigured()) throw new FoundationError("DISABLED");
    const data = z.strictObject({ operationId: z.uuid(), userId: z.uuid(), version: z.coerce.number().int().nonnegative(), requestKey: z.uuid(), confirmed: z.literal("yes") }).parse(Object.fromEntries(["operationId", "userId", "version", "requestKey", "confirmed"].map(key => [key, form.get(key)])));
    await (await getWebsiteRepositories()).retryOperation({ operationId: data.operationId, userId: data.userId, version: data.version }, { requestId: data.requestKey, idempotencyKey: data.requestKey });
    revalidatePath("/admin", "layout"); revalidatePath("/dashboard", "layout");
    return { status: "success", message: "The same durable operation is queued for retry. No second payment decision or key identity was created." };
  } catch (error) { return { status: "error", message: adminErrorMessage(error) }; }
}

export async function importInitialCatalog(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  try {
    assertAdminOrigin(await headers());
    const repository = await getPricingRepository(), current = await repository.readForOwner();
    if (current.status !== "UNPUBLISHED") throw new FoundationError("CONFLICT");
    const requestKey = z.uuid().parse(form.get("requestKey"));
    const catalog = importedCatalog(await callVpnService("catalog", {}));
    const result = await repository.publish({ expectedVersion: 0, requestKey, catalog });
    revalidatePath("/", "layout");
    return { status: "success", message: `Current backend packages imported once as website version ${result.version}. Future website edits are independent.` };
  } catch (error) { return { status: "error", message: adminErrorMessage(error) }; }
}

export async function approvePayment(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  try {
    assertAdminOrigin(await headers());
    if (!fulfilmentEnabled() || !serviceConfigured()) throw new FoundationError("DISABLED");
    const input = z.strictObject({ evidenceId: z.uuid(), requestKey: z.uuid(), confirmed: z.literal("yes"), transaction: z.string().trim().min(4).max(100).regex(/^[A-Za-z0-9 -]+$/) }).parse(Object.fromEntries(["evidenceId", "requestKey", "confirmed", "transaction"].map(key => [key, form.get(key)])));
    const target = await (await getAdminRepository()).paymentRejectionTarget(input.evidenceId);
    // Globally deduplicate a bank transaction without storing its private reference.
    const hex = createHash("sha256").update(`metro-payment:${input.transaction.replace(/[ -]/g, "").toUpperCase()}`).digest("hex");
    const verificationRef = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    await (await getWebsiteRepositories()).decidePayment({ ...target, decision: "APPROVED", verificationRef }, { requestId: input.requestKey, idempotencyKey: input.requestKey });
    revalidatePath("/admin", "layout"); revalidatePath("/dashboard", "layout");
    return { status: "success", message: "Payment confirmed after review. A durable VPN fulfilment request is queued; access is delivered only after verified activation." };
  } catch (error) { return { status: "error", message: adminErrorMessage(error) }; }
}

export async function recordConnectionTest(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  try {
    assertAdminOrigin(await headers());
    const data = z.strictObject({ userId: z.uuid(), issueId: z.uuid(), version: z.coerce.number().int().nonnegative(), result: z.enum(["SUCCEEDED", "FAILED"]), confirmed: z.literal("yes"), requestKey: z.uuid() }).parse(Object.fromEntries(["userId", "issueId", "version", "result", "confirmed", "requestKey"].map(key => [key, form.get(key)])));
    await (await getWebsiteRepositories()).recordDiagnosis({ userId: data.userId, issueId: data.issueId, version: data.version, result: data.result }, { requestId: data.requestKey, idempotencyKey: data.requestKey });
    revalidatePath("/admin/support"); revalidatePath("/dashboard/secure-access");
    return { status: "success", message: "Manual Outline connection test recorded. Customer troubleshooting follows this result." };
  } catch (error) { return { status: "error", message: adminErrorMessage(error) }; }
}

export async function requestKeyReplacement(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  try {
    assertAdminOrigin(await headers());
    if (!fulfilmentEnabled() || !serviceConfigured()) throw new FoundationError("DISABLED");
    const data = z.strictObject({ userId: z.uuid(), serviceId: z.uuid(), issueId: z.uuid(), expectedVersion: z.coerce.number().int().nonnegative(), confirmed: z.literal("yes"), requestKey: z.uuid() }).parse(Object.fromEntries(["userId", "serviceId", "issueId", "expectedVersion", "confirmed", "requestKey"].map(key => [key, form.get(key)])));
    const target = await (await getAdminRepository()).service(data.serviceId);
    if (target.userId !== data.userId) throw new FoundationError("FORBIDDEN");
    const fresh = await liveServiceStatus({ userId: target.userId, externalId: target.entitlement.id, version: target.entitlement.version });
    if (!fresh.status.canConnect || fresh.entitlement?.version !== data.expectedVersion) throw new FoundationError("CONFLICT");
    await (await getWebsiteRepositories()).requestReplacement({ userId: data.userId, serviceId: data.serviceId, issueId: data.issueId, expectedVersion: data.expectedVersion }, { requestId: data.requestKey, idempotencyKey: data.requestKey });
    revalidatePath("/admin/support"); revalidatePath("/admin/notifications");
    return { status: "success", message: "Controlled replacement queued. The backend must reconcile usage, revoke the old key and verify the finite new allowance before delivery." };
  } catch (error) { return { status: "error", message: adminErrorMessage(error) }; }
}

export async function publishPricing(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  try {
    assertAdminOrigin(await headers());
    const body = form.get("pricing");
    if (typeof body !== "string" || Buffer.byteLength(body) > 40_000) throw new FoundationError("INVALID_REQUEST");
    let input: unknown;
    try { input = JSON.parse(body); } catch { throw new FoundationError("INVALID_REQUEST"); }
    const result = await (await getPricingRepository()).publish(input);
    for (const path of ["/", "/services", "/services/secure-access", "/plans", "/checkout", "/dashboard", "/dashboard/services", "/dashboard/secure-access", "/admin", "/admin/plans", "/admin/discounts", "/admin/audit"]) revalidatePath(path);
    return { status: "success", message: `Website pricing version ${result.version} is published. Public prices are updated.`, version: result.version };
  } catch (error) { return { status: "error", message: adminErrorMessage(error) }; }
}

export async function rejectPayment(_previous: AdminActionState, form: FormData): Promise<AdminActionState> {
  try {
    assertAdminOrigin(await headers());
    const parsed = z.strictObject({ evidenceId: z.uuid(), requestKey: z.uuid(), confirmed: z.literal("yes"), rejectionReason: rejectionReasonSchema }).safeParse(Object.fromEntries(["evidenceId", "requestKey", "confirmed", "rejectionReason"].map(key => [key, form.get(key)])));
    if (!parsed.success) throw new FoundationError("INVALID_REQUEST");
    const target = await (await getAdminRepository()).paymentRejectionTarget(parsed.data.evidenceId);
    await (await getWebsiteRepositories()).decidePayment({ ...target, decision: "REJECTED", rejectionReason: parsed.data.rejectionReason, verificationRef: parsed.data.requestKey }, { requestId: parsed.data.requestKey, idempotencyKey: parsed.data.requestKey });
    for (const path of ["/admin", "/admin/payments", "/admin/orders", "/admin/audit", "/dashboard/orders"]) revalidatePath(path);
    return { status: "success", message: "Evidence rejected. The decision is recorded in Audit History; no payment was approved and no VPN operation was created." };
  } catch (error) { return { status: "error", message: adminErrorMessage(error) }; }
}
