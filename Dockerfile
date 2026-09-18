# syntax=docker/dockerfile:1

# ---- 构建前端（Vite + TS）----
FROM node:22-alpine AS web
WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- 运行时（Node API + 静态资源）----
FROM node:22-alpine AS runtime
RUN apk add --no-cache ca-certificates
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8790 \
    SESSION_DIR=/data/sessions
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/ ./server/
COPY --from=web /build/dist ./web/dist
RUN mkdir -p /data \
    && addgroup -S app \
    && adduser -S app -G app \
    && chown -R app:app /app /data
USER app
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8790/api/health || exit 1
CMD ["node", "server/index.mjs"]
