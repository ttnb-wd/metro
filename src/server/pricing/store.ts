import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { catalogSchema, PRICING_MIGRATION, publishPricingSchema, type PricingState } from "@/features/pricing/catalog";
import type { Prisma, PrismaClient } from "../db/generated/client";
import { FoundationError, type SessionReader } from "../owner/authorization";
import { buildAdminAccess } from "../admin/access";

type ReadDb = Pick<Prisma.TransactionClient, "$queryRaw" | "websitePricingRelease">;
export async function pricingSchemaReady(db: ReadDb, write = false): Promise<boolean> {
  const [table] = await db.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass('public.metro_pricing_release') IS NOT NULL AS present`;
  if (!table?.present) return false;
  const [state] = await db.$queryRaw<Array<{ migrated: boolean; readable: boolean; writable: boolean }>>`
    SELECT EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name=${PRICING_MIGRATION} AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migrated,
      has_table_privilege(current_user,'metro_pricing_release','SELECT') AS readable,
      has_table_privilege(current_user,'metro_pricing_release','INSERT') AS writable`;
  return !!state?.migrated && state.readable && (!write || state.writable);
}

export async function readPricing(db: ReadDb): Promise<PricingState> {
  if (!await pricingSchemaReady(db)) return { status: "MIGRATION_PENDING" };
  const row = await db.websitePricingRelease.findFirst({ orderBy: { version: "desc" }, select: { id: true, version: true, createdAt: true, catalog: true } });
  if (!row) return { status: "UNPUBLISHED" };
  const catalog = catalogSchema.safeParse(row.catalog);
  if (!catalog.success) throw new FoundationError("UNAVAILABLE");
  return { status: "READY", release: { id: row.id, version: row.version, createdAt: row.createdAt.toISOString(), catalog: catalog.data } };
}

export function buildPricingRepository(db: PrismaClient, readSession?: SessionReader) {
  const access = buildAdminAccess(db, readSession);
  return {
    readForOwner: () => access(({ tx }) => readPricing(tx)),
    async publish(input: unknown) {
      const parsed = publishPricingSchema.safeParse(input);
      if (!parsed.success) throw new FoundationError("INVALID_REQUEST");
      const data = parsed.data;
      const digest = createHash("sha256").update(JSON.stringify({ expectedVersion: data.expectedVersion, catalog: data.catalog })).digest("hex");
      return access(async ({ tx, account }) => {
        if (!await pricingSchemaReady(tx, true)) throw new FoundationError("UNAVAILABLE");
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('metro:website-pricing',0))::text`;
        const prior = await tx.websitePricingRelease.findUnique({ where: { requestKey: data.requestKey } });
        if (prior) {
          if (prior.createdById !== account.id || prior.payloadDigest !== digest) throw new FoundationError("CONFLICT");
          return { version: prior.version, id: prior.id };
        }
        const current = await tx.websitePricingRelease.findFirst({ orderBy: { version: "desc" }, select: { version: true } });
        if ((current?.version ?? 0) !== data.expectedVersion) throw new FoundationError("CONFLICT");
        // Versions and audit append commit together. No existing order snapshot is touched.
        const row = await tx.websitePricingRelease.create({ data: { id: randomUUID(), version: data.expectedVersion + 1, catalog: data.catalog, createdById: account.id, requestKey: data.requestKey, payloadDigest: digest } });
        await tx.websiteAuditEvent.create({ data: {
          actorId: account.id, targetUserId: account.id, action: "PRICING_PUBLISHED", outcome: "SUCCESS", resourceId: row.id,
          reasonCode: "OWNER_WEBSITE_PRICING", requestId: randomUUID(), idempotencyKey: data.requestKey,
        } });
        return { id: row.id, version: row.version };
      }, true);
    },
  };
}
