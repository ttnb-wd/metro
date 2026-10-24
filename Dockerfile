FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM dependencies AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# Build without production credentials, database access or enabled integrations.
RUN node scripts/verification/trusted-build-policy.mjs && \
    METRO_STANDALONE_BUILD=true METRO_HTTPS_ONLY=true METRO_AUTH_ENABLED=false \
    METRO_FULFILMENT_ENABLED=false METRO_NOTIFICATION_EMAIL_ENABLED=false npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node deploy/portable/runtime-check.mjs ./runtime-check.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "./runtime-check.mjs", "server.js"]
