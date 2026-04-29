FROM node:18.16.1-alpine

WORKDIR /app

RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apk/repositories && \
    apk add --no-cache python3 make g++ curl

RUN npm config set registry https://registry.npmmirror.com && \
    npm install -g pnpm@10.33.0

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.json ./
COPY .npmrc ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/server/package.json packages/server/tsconfig.json ./packages/server/

ENV CI=true
ENV NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node
RUN pnpm config set registry https://registry.npmmirror.com && \
    pnpm config set node-linker hoisted && \
    (pnpm install --frozen-lockfile || pnpm install)

COPY packages/core/src ./packages/core/src
COPY packages/server/src ./packages/server/src

RUN pnpm --filter @qunkins/core build && \
    pnpm --filter @qunkins/server build

COPY packages/web/dist ./packages/web/dist

RUN mkdir -p /app/data /app/logs

ENV NODE_ENV=production
EXPOSE 9800

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:9800/health || exit 1

CMD ["node", "packages/server/dist/index.js"]
