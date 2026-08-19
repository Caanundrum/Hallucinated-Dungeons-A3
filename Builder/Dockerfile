# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY tsconfig.base.json tsconfig.server.json tsconfig.client.json vite.config.ts ./
COPY src ./src
RUN npm ci && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HD_ENV_SCHEMA_VERSION=1 \
    HD_ENVIRONMENT_CLASS=milestone \
    HD_RUNTIME_MODE=frozen_certification \
    HD_PUBLIC_SURFACE=gold_master \
    HD_SERVER_HOST=0.0.0.0 \
    HD_CLIENT_BUNDLE_DIR=/app/dist/client
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /src/dist ./dist
EXPOSE 8080
# Start Node directly. A shell entrypoint.sh with Windows CRLF would exit
# before binding PORT, which is what Cloud Run reports as a startup timeout.
CMD ["node", "dist/server/index.js"]
