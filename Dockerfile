FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY prisma ./prisma
COPY skills ./skills
COPY scripts ./scripts
RUN npm install --no-audit --no-fund
RUN npm run db:generate
RUN npm run build --workspace @family-edu/api
RUN npm run build --workspace @family-edu/web

FROM node:22-alpine AS runner
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY prisma ./prisma
COPY skills ./skills
COPY scripts ./scripts
RUN npm install --no-audit --no-fund
RUN npm run db:generate
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/dist ./public
ENV NODE_ENV=production
ENV WEB_DIST=/app/public
EXPOSE 4100
CMD ["sh", "-c", "npm run db:deploy && node apps/api/dist/index.js"]
