-- Website foundation only. Apply only to a verified disposable target in Step 06B.2.

BEGIN;

CREATE TABLE "metro_owner_binding" (
  "slot" INTEGER NOT NULL DEFAULT 1 PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "metro_website_order" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "quoteSnapshot" JSONB NOT NULL,
  "totalMmk" DECIMAL(30, 0) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'MMK',
  "state" TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
  "payment" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "provisioning" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "metro_payment_evidence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "storageRef" TEXT NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "mediaType" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "metro_payment_decision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "verificationRef" TEXT NOT NULL,
  "amountMmk" DECIMAL(30, 0) NOT NULL,
  "ownerId" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "metro_service_reference" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "version" INTEGER NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "metro_support_issue" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "serviceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" VARCHAR(1000) NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'OPEN',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "metro_issue_event" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "issueId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "metro_owner_audit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "metro_website_request" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "digest" CHAR(64) NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'RUNNING',
  "resultId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "metro_website_operation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "resourceKey" TEXT NOT NULL,
  "orderId" TEXT,
  "serviceId" TEXT,
  "issueId" TEXT,
  "expectedVersion" INTEGER,
  "frozenSnapshot" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'QUEUED',
  "version" INTEGER NOT NULL DEFAULT 0,
  "candidateKeyId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "metro_website_outbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "operationId" TEXT,
  "topic" TEXT NOT NULL,
  "businessKey" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseId" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "metro_owner_binding_userId_key" ON "metro_owner_binding" ("userId");

ALTER TABLE "metro_owner_binding" ADD CONSTRAINT "metro_owner_binding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "metro_user" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "metro_website_order_quoteId_key" ON "metro_website_order" ("quoteId");

CREATE UNIQUE INDEX "metro_website_order_id_userId_key" ON "metro_website_order" ("id", "userId");

CREATE INDEX "metro_website_order_userId_createdAt_idx" ON "metro_website_order" ("userId", "createdAt");

ALTER TABLE "metro_website_order" ADD CONSTRAINT "metro_website_order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "metro_user" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "metro_payment_evidence_storageRef_key" ON "metro_payment_evidence" ("storageRef");

CREATE UNIQUE INDEX "metro_payment_evidence_id_orderId_userId_key" ON "metro_payment_evidence" ("id", "orderId", "userId");

CREATE INDEX "metro_payment_evidence_userId_orderId_idx" ON "metro_payment_evidence" ("userId", "orderId");

ALTER TABLE "metro_payment_evidence" ADD CONSTRAINT "metro_payment_evidence_orderId_userId_fkey" FOREIGN KEY ("orderId", "userId") REFERENCES "metro_website_order" ("id", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "metro_payment_decision_verificationRef_key" ON "metro_payment_decision" ("verificationRef");

CREATE INDEX "metro_payment_decision_userId_orderId_idx" ON "metro_payment_decision" ("userId", "orderId");

ALTER TABLE "metro_payment_decision" ADD CONSTRAINT "metro_payment_decision_orderId_userId_fkey" FOREIGN KEY ("orderId", "userId") REFERENCES "metro_website_order" ("id", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "metro_payment_decision" ADD CONSTRAINT "metro_payment_decision_evidenceId_orderId_userId_fkey" FOREIGN KEY ("evidenceId", "orderId", "userId") REFERENCES "metro_payment_evidence" ("id", "orderId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "metro_payment_decision" ADD CONSTRAINT "metro_payment_decision_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "metro_user" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "metro_service_reference_externalId_key" ON "metro_service_reference" ("externalId");

CREATE UNIQUE INDEX "metro_service_reference_id_userId_key" ON "metro_service_reference" ("id", "userId");

CREATE INDEX "metro_service_reference_userId_idx" ON "metro_service_reference" ("userId");

ALTER TABLE "metro_service_reference" ADD CONSTRAINT "metro_service_reference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "metro_user" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "metro_support_issue_id_userId_key" ON "metro_support_issue" ("id", "userId");

CREATE UNIQUE INDEX "metro_support_issue_id_serviceId_userId_key" ON "metro_support_issue" ("id", "serviceId", "userId");

CREATE INDEX "metro_support_issue_userId_createdAt_idx" ON "metro_support_issue" ("userId", "createdAt");

ALTER TABLE "metro_support_issue" ADD CONSTRAINT "metro_support_issue_serviceId_userId_fkey" FOREIGN KEY ("serviceId", "userId") REFERENCES "metro_service_reference" ("id", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "metro_issue_event_issueId_version_key" ON "metro_issue_event" ("issueId", "version");

CREATE INDEX "metro_issue_event_userId_issueId_idx" ON "metro_issue_event" ("userId", "issueId");

ALTER TABLE "metro_issue_event" ADD CONSTRAINT "metro_issue_event_issueId_userId_fkey" FOREIGN KEY ("issueId", "userId") REFERENCES "metro_support_issue" ("id", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "metro_issue_event" ADD CONSTRAINT "metro_issue_event_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "metro_user" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "metro_owner_audit_targetUserId_createdAt_idx" ON "metro_owner_audit" ("targetUserId", "createdAt");

ALTER TABLE "metro_owner_audit" ADD CONSTRAINT "metro_owner_audit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "metro_user" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "metro_owner_audit" ADD CONSTRAINT "metro_owner_audit_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "metro_user" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "metro_website_request_actorId_action_key_key" ON "metro_website_request" ("actorId", "action", "key");

CREATE INDEX "metro_website_request_userId_idx" ON "metro_website_request" ("userId");

ALTER TABLE "metro_website_request" ADD CONSTRAINT "metro_website_request_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "metro_user" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "metro_website_request" ADD CONSTRAINT "metro_website_request_userId_fkey" FOREIGN KEY ("userId") REFERENCES "metro_user" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "metro_website_operation_kind_resourceKey_key" ON "metro_website_operation" ("kind", "resourceKey");

CREATE UNIQUE INDEX "metro_website_operation_id_userId_key" ON "metro_website_operation" ("id", "userId");

CREATE INDEX "metro_website_operation_userId_idx" ON "metro_website_operation" ("userId");

ALTER TABLE "metro_website_operation" ADD CONSTRAINT "metro_website_operation_orderId_userId_fkey" FOREIGN KEY ("orderId", "userId") REFERENCES "metro_website_order" ("id", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "metro_website_operation" ADD CONSTRAINT "metro_website_operation_serviceId_userId_fkey" FOREIGN KEY ("serviceId", "userId") REFERENCES "metro_service_reference" ("id", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "metro_website_operation" ADD CONSTRAINT "metro_website_operation_issueId_serviceId_userId_fkey" FOREIGN KEY ("issueId", "serviceId", "userId") REFERENCES "metro_support_issue" ("id", "serviceId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "metro_website_outbox_businessKey_key" ON "metro_website_outbox" ("businessKey");

CREATE INDEX "metro_website_outbox_userId_idx" ON "metro_website_outbox" ("userId");

CREATE INDEX "metro_website_outbox_state_availableAt_idx" ON "metro_website_outbox" ("state", "availableAt");

ALTER TABLE "metro_website_outbox" ADD CONSTRAINT "metro_website_outbox_operationId_userId_fkey" FOREIGN KEY ("operationId", "userId") REFERENCES "metro_website_operation" ("id", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Additional reviewed invariants follow.
ALTER TABLE "metro_owner_binding" ADD CONSTRAINT "metro_single_owner" CHECK (slot = 1);
ALTER TABLE "metro_website_order" ADD CONSTRAINT "metro_order_values" CHECK (
  "totalMmk" > 0 AND currency = 'MMK' AND version >= 0
  AND state IN ('AWAITING_PAYMENT','FULFILMENT_PENDING','COMPLETE','CANCELLED','REVIEW_REQUIRED')
  AND payment IN ('UNVERIFIED','UNDER_REVIEW','CONFIRMED','REJECTED','REFUND_REVIEW','REFUNDED')
  AND provisioning IN ('NOT_REQUESTED','QUEUED','PROCESSING','RETRY_PENDING','SUCCEEDED','REVIEW_REQUIRED')
  AND (state <> 'COMPLETE' OR (payment = 'CONFIRMED' AND provisioning = 'SUCCEEDED'))
  AND (state <> 'FULFILMENT_PENDING' OR payment = 'CONFIRMED')
  AND (("quoteSnapshot"->'owner'->>'subject' = "userId") AND ("quoteSnapshot"->'owner'->>'issuer' = 'metro-website')
    AND ("quoteSnapshot"->>'id' = "quoteId") AND ("quoteSnapshot"->>'totalMmk' = "totalMmk"::text)) IS TRUE);
ALTER TABLE "metro_payment_evidence" ADD CONSTRAINT "metro_evidence_values" CHECK (
  bytes BETWEEN 1 AND 10485760 AND "mediaType" IN ('image/png','image/jpeg','application/pdf') AND sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE "metro_payment_decision" ADD CONSTRAINT "metro_decision_values" CHECK (
  decision IN ('APPROVED','REJECTED') AND "amountMmk" > 0 AND "reasonCode" IN ('PAYMENT_MATCHED','EVIDENCE_REJECTED'));
CREATE UNIQUE INDEX "metro_one_approved_payment" ON "metro_payment_decision" ("orderId") WHERE decision = 'APPROVED';
ALTER TABLE "metro_service_reference" ADD CONSTRAINT "metro_service_owner" CHECK (version >= 0
  AND ((snapshot->'owner'->>'subject' = "userId") AND (snapshot->'owner'->>'issuer' = 'metro-website')
    AND (snapshot->>'id' = "externalId") AND ((snapshot->>'version')::integer = version)) IS TRUE);
ALTER TABLE "metro_support_issue" ADD CONSTRAINT "metro_issue_values" CHECK (
  attempts BETWEEN 0 AND 3 AND version >= 0 AND category IN ('CANNOT_CONNECT','UNSTABLE_CONNECTION')
  AND state IN ('OPEN','DIAGNOSING','TROUBLESHOOTING','REPLACEMENT_APPROVED','REVIEW_REQUIRED','RESOLVED','CLOSED')
  AND description !~* '(ss://|postgresql?://|bearer[[:space:]])');
ALTER TABLE "metro_issue_event" ADD CONSTRAINT "metro_issue_event_values" CHECK (attempt BETWEEN 0 AND 3 AND version >= 0
  AND kind IN ('REPORTED','ADMIN_TEST_SUCCEEDED','ADMIN_TEST_FAILED','CUSTOMER_RETRY_SUCCEEDED','CUSTOMER_RETRY_FAILED'));
ALTER TABLE "metro_owner_audit" ADD CONSTRAINT "metro_audit_values" CHECK (
  action IN ('OWNER_BOUND','PAYMENT_DECISION','ISSUE_DIAGNOSIS','REPLACEMENT_REQUEST','OUTBOX_CLAIM','OUTBOX_ACK','CHECKPOINT','AUDIT_READ','EVIDENCE_READ')
  AND outcome IN ('SUCCESS','FAILURE','DENIED') AND "reasonCode" IN ('MANUAL_BINDING','PAYMENT_MATCHED','EVIDENCE_REJECTED','ADMIN_TEST_SUCCEEDED','ADMIN_TEST_FAILED','VERIFIED_KEY_FAILURE','WORKER_CHECKPOINT','OWNER_READ','NOT_OWNER')
  AND "requestId" ~ '^[a-f0-9-]{36}$' AND "idempotencyKey" ~ '^[a-f0-9-]{36}$');
ALTER TABLE "metro_website_request" ADD CONSTRAINT "metro_request_values" CHECK (
  state IN ('RUNNING','DONE') AND (state <> 'DONE' OR "resultId" IS NOT NULL) AND digest ~ '^[a-f0-9]{64}$'
  AND action IN ('ORDER_CREATE','EVIDENCE_ADD','PAYMENT_DECISION','ISSUE_CREATE','ISSUE_DIAGNOSIS','ISSUE_RETRY','REPLACEMENT_REQUEST','OUTBOX_CLAIM','OUTBOX_ACK','CHECKPOINT','AUDIT_READ','EVIDENCE_READ'));
ALTER TABLE "metro_website_operation" ADD CONSTRAINT "metro_operation_values" CHECK (
  version >= 0 AND state IN ('QUEUED','PROCESSING','RETRY_PENDING','SUCCEEDED','REVIEW_REQUIRED')
  AND ((kind = 'PROVISION' AND "orderId" IS NOT NULL AND "serviceId" IS NULL AND "issueId" IS NULL AND "expectedVersion" IS NULL AND "resourceKey" = "orderId")
    OR (kind = 'REPLACEMENT' AND "orderId" IS NULL AND "serviceId" IS NOT NULL AND "issueId" IS NOT NULL AND "expectedVersion" IS NOT NULL AND "expectedVersion" >= 0
      AND "resourceKey" = "serviceId" || ':' || "expectedVersion"::text)));
ALTER TABLE "metro_website_outbox" ADD CONSTRAINT "metro_outbox_values" CHECK (
  version >= 0 AND attempts >= 0 AND state IN ('PENDING','LEASED','DELIVERED')
  AND topic IN ('VPN_FULFILMENT_REQUESTED','VPN_REPLACEMENT_REQUESTED','WEBSITE_ISSUE_REPORTED')
  AND ((state = 'LEASED' AND "leaseId" IS NOT NULL AND "leaseUntil" IS NOT NULL)
    OR (state <> 'LEASED' AND "leaseId" IS NULL AND "leaseUntil" IS NULL)));

CREATE FUNCTION metro_foundation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable website record' USING ERRCODE = '42501'; END;
$$;
CREATE TRIGGER metro_owner_immutable BEFORE UPDATE OR DELETE ON "metro_owner_binding" FOR EACH ROW EXECUTE FUNCTION metro_foundation_immutable();
CREATE TRIGGER metro_owner_no_truncate BEFORE TRUNCATE ON "metro_owner_binding" FOR EACH STATEMENT EXECUTE FUNCTION metro_foundation_immutable();
CREATE TRIGGER metro_audit_immutable BEFORE UPDATE OR DELETE ON "metro_owner_audit" FOR EACH ROW EXECUTE FUNCTION metro_foundation_immutable();
CREATE TRIGGER metro_decision_immutable BEFORE UPDATE OR DELETE ON "metro_payment_decision" FOR EACH ROW EXECUTE FUNCTION metro_foundation_immutable();
CREATE TRIGGER metro_evidence_immutable BEFORE UPDATE OR DELETE ON "metro_payment_evidence" FOR EACH ROW EXECUTE FUNCTION metro_foundation_immutable();
CREATE TRIGGER metro_issue_event_immutable BEFORE UPDATE OR DELETE ON "metro_issue_event" FOR EACH ROW EXECUTE FUNCTION metro_foundation_immutable();

CREATE FUNCTION metro_foundation_owner_actor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor text;
BEGIN
  IF TG_TABLE_NAME = 'metro_payment_decision' THEN actor := NEW."ownerId"; ELSE actor := NEW."actorId"; END IF;
  IF TG_TABLE_NAME = 'metro_owner_audit' THEN
    IF NEW.outcome = 'DENIED' THEN RETURN NEW; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.metro_owner_binding WHERE slot = 1 AND "userId" = actor) THEN
    RAISE EXCEPTION 'OWNER required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER metro_decision_owner BEFORE INSERT ON "metro_payment_decision" FOR EACH ROW EXECUTE FUNCTION metro_foundation_owner_actor();
CREATE TRIGGER metro_audit_owner BEFORE INSERT ON "metro_owner_audit" FOR EACH ROW EXECUTE FUNCTION metro_foundation_owner_actor();

CREATE FUNCTION metro_foundation_bind_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.metro_owner_audit (id,"actorId","targetUserId",action,outcome,"resourceId","reasonCode","requestId","idempotencyKey")
    VALUES (gen_random_uuid()::text, NEW."userId",NEW."userId",'OWNER_BOUND','SUCCESS',NEW."userId",'MANUAL_BINDING',gen_random_uuid()::text,gen_random_uuid()::text);
  RETURN NEW;
END;
$$;
CREATE TRIGGER metro_owner_bind_audit AFTER INSERT ON "metro_owner_binding" FOR EACH ROW EXECUTE FUNCTION metro_foundation_bind_audit();

CREATE FUNCTION metro_foundation_order_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD."id",OLD."userId",OLD."quoteId",OLD."quoteSnapshot",OLD."totalMmk",OLD.currency)
    IS DISTINCT FROM ROW(NEW."id",NEW."userId",NEW."quoteId",NEW."quoteSnapshot",NEW."totalMmk",NEW.currency) THEN
    RAISE EXCEPTION 'Immutable order snapshot' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER metro_order_snapshot BEFORE UPDATE ON "metro_website_order" FOR EACH ROW EXECUTE FUNCTION metro_foundation_order_snapshot();
REVOKE ALL ON "metro_owner_binding" FROM PUBLIC;
ALTER TABLE "metro_website_outbox" ADD CONSTRAINT "metro_outbox_user_fkey" FOREIGN KEY ("userId") REFERENCES "metro_user"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "metro_candidate_key_unique" ON "metro_website_operation" ("candidateKeyId");
CREATE FUNCTION metro_foundation_operation_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.id,OLD."userId",OLD.kind,OLD."resourceKey",OLD."orderId",OLD."serviceId",OLD."issueId",OLD."expectedVersion",OLD."frozenSnapshot")
    IS DISTINCT FROM ROW(NEW.id,NEW."userId",NEW.kind,NEW."resourceKey",NEW."orderId",NEW."serviceId",NEW."issueId",NEW."expectedVersion",NEW."frozenSnapshot")
    OR (OLD."candidateKeyId" IS NOT NULL AND OLD."candidateKeyId" IS DISTINCT FROM NEW."candidateKeyId") THEN
    RAISE EXCEPTION 'Immutable operation checkpoint' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER metro_operation_snapshot BEFORE UPDATE ON "metro_website_operation" FOR EACH ROW EXECUTE FUNCTION metro_foundation_operation_snapshot();
CREATE FUNCTION metro_foundation_request_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.id,OLD."actorId",OLD."userId",OLD.action,OLD.key,OLD.digest) IS DISTINCT FROM ROW(NEW.id,NEW."actorId",NEW."userId",NEW.action,NEW.key,NEW.digest)
    OR (OLD.state = 'DONE' AND ROW(OLD.state,OLD."resultId") IS DISTINCT FROM ROW(NEW.state,NEW."resultId")) THEN
    RAISE EXCEPTION 'Immutable request receipt' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER metro_request_snapshot BEFORE UPDATE ON "metro_website_request" FOR EACH ROW EXECUTE FUNCTION metro_foundation_request_snapshot();
CREATE TRIGGER metro_request_retained BEFORE DELETE ON "metro_website_request" FOR EACH ROW EXECUTE FUNCTION metro_foundation_immutable();
COMMIT;
