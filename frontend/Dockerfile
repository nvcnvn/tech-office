FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable
WORKDIR /app

FROM base AS builder

COPY . .
RUN pnpm install --frozen-lockfile --filter web...

ARG NEXT_PUBLIC_BASE_URL=https://transformar.work
ARG NEXT_PUBLIC_API_URL=https://transformar.api.devguards.com
ARG NEXT_PUBLIC_API_BASE_URL=https://transformar.api.devguards.com
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=751712281610-ul8m5aval9208357ljvm31uuutt80o9l.apps.googleusercontent.com
ARG NEXT_PUBLIC_APPLE_CLIENT_ID=work.transformar.web
ARG RELEASE_TAG=dev

ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_APPLE_CLIENT_ID=$NEXT_PUBLIC_APPLE_CLIENT_ID
ENV RELEASE_TAG=$RELEASE_TAG
ENV NEXT_PUBLIC_RELEASE_TAG=$RELEASE_TAG

RUN pnpm --filter web... build

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=13000
ENV HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public

USER node
EXPOSE 13000

CMD ["node", "apps/web/server.js"]
