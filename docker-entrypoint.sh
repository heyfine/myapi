#!/bin/sh
set -e

DATA_DIR="/app/data"
export GATEWAY_SECRET="${GATEWAY_SECRET:-dev-insecure-secret-change-me}"

# 首次启动自动初始化数据库（建表 + 种子管理员 admin/admin123 + 默认定价/重试规则）
if [ ! -f "$DATA_DIR/gateway.db" ]; then
  echo "[entrypoint] 首次启动，初始化数据库..."
  mkdir -p "$DATA_DIR"
  npx tsx scripts/init-db.ts
fi

echo "[entrypoint] 启动服务，端口 ${PORT:-3777}"
exec npm start
