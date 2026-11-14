# syntax=docker/dockerfile:1

FROM node:24-alpine AS base

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.17.0

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
ARG APP_VERSION
ENV NEXT_PUBLIC_APP_VERSION=${APP_VERSION}
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build && pnpm test:basepath

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/scripts/runtime-start.mjs ./runtime-start.mjs
COPY --from=builder --chown=node:node /app/scripts/runtime-config.mjs ./runtime-config.mjs

USER node
EXPOSE 3000
CMD ["node", "runtime-start.mjs"]
