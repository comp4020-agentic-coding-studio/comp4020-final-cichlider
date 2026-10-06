# syntax = docker/dockerfile:1

# The wall: one Node process, no build step. Node runs the TypeScript server
# directly, the browser gets plain JS from public/, and everything people paint
# lives in SQLite on the /data volume (fly.toml mounts it).
FROM docker.io/library/node:24.21.0-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
RUN npm install -g pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY server/ server/
COPY public/ public/
COPY README.md ./
COPY docs/ docs/
CMD ["node", "--disable-warning=ExperimentalWarning", "server/main.ts"]
