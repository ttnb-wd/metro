-- Apply the initial authentication schema atomically.
BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "metro_user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metro_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metro_session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "metro_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metro_account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metro_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metro_verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metro_verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metro_rate_limit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "metro_rate_limit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "metro_user_email_key" ON "metro_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "metro_session_token_key" ON "metro_session"("token");

-- CreateIndex
CREATE INDEX "metro_session_userId_idx" ON "metro_session"("userId");

-- CreateIndex
CREATE INDEX "metro_session_expiresAt_idx" ON "metro_session"("expiresAt");

-- CreateIndex
CREATE INDEX "metro_account_userId_idx" ON "metro_account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "metro_account_providerId_accountId_key" ON "metro_account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "metro_verification_identifier_idx" ON "metro_verification"("identifier");

-- CreateIndex
CREATE INDEX "metro_verification_expiresAt_idx" ON "metro_verification"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "metro_rate_limit_key_key" ON "metro_rate_limit"("key");

-- CreateIndex
CREATE INDEX "metro_rate_limit_lastRequest_idx" ON "metro_rate_limit"("lastRequest");

-- AddForeignKey
ALTER TABLE "metro_session" ADD CONSTRAINT "metro_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "metro_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metro_account" ADD CONSTRAINT "metro_account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "metro_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
