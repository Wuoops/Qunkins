#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

QUNKINS_SECRET="${QUNKINS_SECRET:-change-me-to-a-32-char-secret-key}"
QUNKINS_AUTH_ENABLED="${QUNKINS_AUTH_ENABLED:-false}"

echo "==> 构建镜像..."
docker build -f "$SCRIPT_DIR/Dockerfile" -t qunkins:dev "$PROJECT_DIR"

echo "==> 清理旧容器..."
docker rm -f qunkins-server qunkins-redis 2>/dev/null || true

echo "==> 启动 Redis..."
docker run -d \
  --name qunkins-redis \
  --network=host \
  --restart=unless-stopped \
  -v qunkins-redis-data:/data \
  redis:7-alpine

echo "==> 启动 Qunkins Server..."
docker run -d \
  --name qunkins-server \
  --network=host \
  --restart=unless-stopped \
  -e NODE_ENV=production \
  -e QUNKINS_SECRET="$QUNKINS_SECRET" \
  -e QUNKINS_PORT=9800 \
  -e QUNKINS_DB_PATH=/app/data/qunkins.db \
  -e QUNKINS_LOG_DIR=/app/logs \
  -e QUNKINS_AUTH_ENABLED="$QUNKINS_AUTH_ENABLED" \
  -e REDIS_HOST=127.0.0.1 \
  -e REDIS_PORT=6379 \
  -v qunkins-data:/app/data \
  -v qunkins-logs:/app/logs \
  qunkins:dev

sleep 2
echo ""
echo "==> 状态检查:"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' | grep -E 'NAMES|qunkins'
echo ""
curl -s http://localhost:9800/health && echo ""
echo ""
echo "==> 服务已启动: http://0.0.0.0:9800"
