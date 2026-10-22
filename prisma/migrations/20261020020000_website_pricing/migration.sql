-- Additive website-only pricing. No auth or historical order rows are changed.
BEGIN;
CREATE TABLE "metro_pricing_release" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "catalog" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payloadDigest" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "metro_pricing_release_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "metro_pricing_version_positive" CHECK ("version" > 0),
    CONSTRAINT "metro_pricing_catalog_object" CHECK (jsonb_typeof("catalog")='object'),
    CONSTRAINT "metro_pricing_digest_format" CHECK ("payloadDigest" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "metro_pricing_release_version_key" ON "metro_pricing_release"("version");
CREATE UNIQUE INDEX "metro_pricing_release_requestKey_key" ON "metro_pricing_release"("requestKey");
ALTER TABLE "metro_pricing_release" ADD CONSTRAINT "metro_pricing_release_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "metro_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION metro_pricing_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Website pricing releases are immutable';
END;
$$;
CREATE TRIGGER metro_pricing_no_update_delete BEFORE UPDATE OR DELETE ON metro_pricing_release
FOR EACH ROW EXECUTE FUNCTION metro_pricing_append_only();
CREATE TRIGGER metro_pricing_no_truncate BEFORE TRUNCATE ON metro_pricing_release
FOR EACH STATEMENT EXECUTE FUNCTION metro_pricing_append_only();
REVOKE ALL ON FUNCTION metro_pricing_append_only() FROM PUBLIC;

CREATE FUNCTION metro_pricing_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.metro_owner_binding WHERE slot=1 AND "userId"=NEW."createdById") THEN
    RAISE EXCEPTION 'OWNER required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER metro_pricing_owner_insert BEFORE INSERT ON "metro_pricing_release"
FOR EACH ROW EXECUTE FUNCTION metro_pricing_owner();
REVOKE ALL ON FUNCTION metro_pricing_owner() FROM PUBLIC;

-- Preserve all existing audit codes; allow only the new explicit pricing event.
ALTER TABLE "metro_owner_audit" DROP CONSTRAINT "metro_audit_values";
ALTER TABLE "metro_owner_audit" ADD CONSTRAINT "metro_audit_values" CHECK (
  action IN ('OWNER_BOUND','PAYMENT_DECISION','ISSUE_DIAGNOSIS','REPLACEMENT_REQUEST','OUTBOX_CLAIM','OUTBOX_ACK','CHECKPOINT','AUDIT_READ','EVIDENCE_READ','PRICING_PUBLISHED')
  AND outcome IN ('SUCCESS','FAILURE','DENIED') AND "reasonCode" IN ('MANUAL_BINDING','PAYMENT_MATCHED','EVIDENCE_REJECTED','ADMIN_TEST_SUCCEEDED','ADMIN_TEST_FAILED','VERIFIED_KEY_FAILURE','WORKER_CHECKPOINT','OWNER_READ','NOT_OWNER','OWNER_WEBSITE_PRICING')
  AND "requestId" ~ '^[a-f0-9-]{36}$' AND "idempotencyKey" ~ '^[a-f0-9-]{36}$');
COMMIT;
