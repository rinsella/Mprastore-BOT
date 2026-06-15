# ===== Stage 1: Build =====
FROM node:20-alpine AS builder

WORKDIR /app

# OpenSSL diperlukan oleh Prisma engine di Alpine.
RUN apk add --no-cache openssl libc6-compat

# Install dependencies (termasuk dev) untuk build.
COPY package.json package-lock.json* ./
RUN npm install

# Salin sumber & schema.
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

# Generate Prisma client & build TypeScript.
RUN npx prisma generate
RUN npm run build

# ===== Stage 2: Runtime =====
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# OpenSSL diperlukan oleh Prisma engine di Alpine saat runtime.
RUN apk add --no-cache openssl libc6-compat

# Hanya dependency produksi.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Salin artefak build & prisma.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 3000

# Jalankan migrasi lalu start bot.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
