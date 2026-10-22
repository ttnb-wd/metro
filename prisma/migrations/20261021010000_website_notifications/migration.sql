-- Additive WEBSITE-only notification history. Rehearse; separate production approval required.
CREATE TABLE "metro_website_notification" (
 "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "audience" TEXT NOT NULL CHECK (audience IN ('CUSTOMER','OWNER')),
 "kind" TEXT NOT NULL, "dedupeKey" VARCHAR(220) NOT NULL, "payload" JSONB NOT NULL,
 "href" VARCHAR(200) NOT NULL CHECK ("href" LIKE '/dashboard/%' OR "href" LIKE '/admin/%' OR "href"='/plans'),
 "readAt" TIMESTAMP(3), "emailState" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("emailState" IN ('PENDING','SENDING','RETRY','SENT','FAILED','UNCERTAIN','SUPPRESSED')),
 "emailErrorCode" VARCHAR(40), "emailSentAt" TIMESTAMP(3), "emailAttempts" INTEGER NOT NULL DEFAULT 0 CHECK ("emailAttempts">=0),
 "emailLeaseId" TEXT, "emailLeaseUntil" TIMESTAMP(3), "emailAvailableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "metro_notification_lease" CHECK (("emailState"='SENDING' AND "emailLeaseId" IS NOT NULL AND "emailLeaseUntil" IS NOT NULL) OR ("emailState"<>'SENDING' AND "emailLeaseId" IS NULL AND "emailLeaseUntil" IS NULL)),
 CONSTRAINT "metro_website_notification_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "metro_website_notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "metro_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "metro_website_notification_dedupeKey_key" ON "metro_website_notification"("dedupeKey");
CREATE INDEX "metro_website_notification_userId_createdAt_idx" ON "metro_website_notification"("userId","createdAt");
CREATE INDEX "metro_website_notification_userId_readAt_idx" ON "metro_website_notification"("userId","readAt");
CREATE INDEX "metro_website_notification_emailState_emailAvailableAt_idx" ON "metro_website_notification"("emailState","emailAvailableAt");
REVOKE ALL ON "metro_website_notification" FROM PUBLIC;
