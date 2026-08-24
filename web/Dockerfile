FROM node:18-alpine AS base
RUN apk add --no-cache openssl

# Dependencies
FROM base AS deps
WORKDIR /app
# NOT: package-lock.json depoya dahil değil. Lockfile üretmek istersen
#      `npm install` bir kez çalıştırıp package-lock.json'ı commit edebilir,
#      ardından bu satırı `npm ci`ye geri çevirebilirsin (reproducible build).
COPY package.json ./
RUN npm install

# Builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Runner
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Şema, db container'ında init.sql (docker-entrypoint-initdb.d) ile kurulur;
# migration'lar db/migrations/ altından elle uygulanır. Web container'ının
# başlangıçta migration çalıştırmasına gerek yok — doğrudan sunucuyu başlat.
CMD ["node", "server.js"]
