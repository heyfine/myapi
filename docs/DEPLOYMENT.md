# 部署指南

## 部署目标

- 当前形态：**本地/单机运行**（Windows，端口 3777），数据在 data/gateway.db
- 代码仓库：https://github.com/heyfine/myapi.git（main 分支）

## 环境变量

| 变量 | 说明 |
| --- | --- |
| GATEWAY_SECRET | 渠道 Key 加密主密钥。**生产必须改为强随机值**；⚠ 一旦更换，旧密文无法解密，渠道 Key 需重新填写 |
| PORT | 可选，默认 3777 |

## 本机/单机部署（当前方式）

1. 克隆仓库，进入目录
2. 首次：`npm install` → `npm run db:init`（创建管理员 admin/admin123 与默认定价/重试规则）
3. 以后启动：双击 `一键启动.bat`，或 `npm run build && npm start`
4. 数据迁移：旧机管理后台"备份还原"导出 JSON → 新机导入（整库覆盖，渠道 Key 自动用新机 GATEWAY_SECRET 重加密）
5. 登录后**立即修改 admin 密码**

## Docker 部署（容器化，推荐的服务器方式）

仓库内已提供 `Dockerfile`（多阶段构建）、`docker-compose.yml`、`docker-entrypoint.sh`：

```bash
# 方式一：docker compose（推荐，自动挂载 ./data 数据卷）
GATEWAY_SECRET=你的强随机密钥 docker compose up -d --build

# 方式二：纯 docker
docker build -t myapi .
docker run -d --name llm-gateway -p 3777:3777 \
  -v /你的数据目录:/app/data \
  -e GATEWAY_SECRET=你的强随机密钥 \
  myapi
```

要点：

- 数据持久化：宿主机目录挂载到 `/app/data`（gateway.db 在里面），升级镜像不丢数据
- 首次启动 entrypoint 自动执行数据库初始化（建表 + 种子管理员 admin/admin123 + 默认定价/重试规则）
- 健康检查：容器内置 HEALTHCHECK（探测 /login）
- 流式响应用 Nginx 反代时记得 `proxy_buffering off;`
- 验证：`docker logs -f llm-gateway` 看启动日志，浏览器开 `http://服务器IP:3777`
- 数据库迁移到容器：把旧机的 data/gateway.db 拷进挂载目录即可（或用备份还原页面导入）

## 上 VPS（直跑方式，不用 Docker）

1. Linux + Node 24：克隆仓库 → `npm install` → `npm run db:init` → `npm run build`
2. 进程守护：`pm2 start npm --name myapi -- start`（或 systemd）
3. 反向代理：Nginx/Caddy 443 → 127.0.0.1:3777（流式响应需关闭代理缓冲，Nginx 加 `proxy_buffering off;`）
4. 定期备份 data/gateway.db（或使用后台"备份还原"导出）

## 关于 Vercel（已评估：不适用）

SQLite 需要可写本地文件，Vercel Serverless 文件系统只读且临时，直接部署会丢数据。如需云部署需先改造（Turso/libsql 驱动），见 docs/TODO.md。

## 上线检查清单

- [ ] GATEWAY_SECRET 已改为强随机值（且不在代码仓库中）
- [ ] admin 默认密码已修改
- [ ] `npm run build` 成功且 `/login` 可访问
- [ ] 用真实渠道做一次流式调用冒烟通过
- [ ] data/gateway.db 已纳入备份计划

## 实际生产部署（云服务器，2026-09-20 迁移至新 IP）

- 主机：云服务器（Ubuntu / aarch64，主机名 ubuntu），**IP `217.142.237.44`**（2026-09-20 从旧机 141.147.147.93 迁移，旧机已下线），SSH 端口 53770，密钥 `~/.ssh/id_ed25519_codex`；服务器同机跑有其他生产服务（vaultwarden/wordpress/litellm 等），docker build 务必 nohup 后台执行
- 本机直连该服务器 SSH **实测可通**（2026-09-20）；若直连超时，可走本机 SOCKS5 代理：`ssh -o ProxyCommand='connect -S 127.0.0.1:10808 %h %p'`（Git 自带 connect.exe）
- 部署目录 `/root/myapi`，容器名 `llm-gateway`，端口 3777
- 部署形态：`docker compose`（bind mount `/root/myapi/data:/app/data`），源码为**非 git 目录**（GitHub 仓库为私有，服务器无凭据，升级走"本地 `git archive` 打包 → scp → 解包"传输，见下方"升级 SOP"）
- `.env` 在 `/root/myapi/.env`（仅 GATEWAY_SECRET，64 位强随机）。**升级/换机时绝不能丢**——换了它，渠道 Key 密文全部解不开
- 入口脚本只在 `gateway.db` 不存在时才跑 init-db，因此升级重建容器**不动数据**；schema 变更（如 2026-09-20 渠道归档的 archived/archived_at 列）在**旧容器还运行时用新镜像以在线 DDL 补列**（见 SOP 第 2.5 步），消除"新代码查旧表"的报错窗口

### 升级 SOP（2026-08-30 实操验证过一次，全程 ~35 分钟）

```bash
# 1) 本地：打包当前 main（替换 tag 名为实际提交）
git archive --format=tar.gz -o myapi.tar.gz main
scp -P 53770 myapi.tar.gz root@服务器:/tmp/

# 2) 服务器：解包到新目录 + 拷 .env + 预构建（不影响运行中的旧容器）
mkdir /root/myapi-new && tar -xzf /tmp/myapi.tar.gz -C /root/myapi-new
cp -p /root/myapi/.env /root/myapi-new/.env
# 源码标记预检：grep 本次新功能的英文标记，确认包里是新代码
grep -c "archived" /root/myapi-new/src/lib/schema.ts

# 2.5) 若本次含 schema 变更：趁旧容器还在运行，用新镜像做在线 DDL 补列
#      （SQLite ADD COLUMN 秒级在线；新容器启动即有新列，避免报错窗口）
docker run --rm --entrypoint node -v /root/myapi/data:/app/data myapi-myapi:latest -e "
const db=require('better-sqlite3')('/app/data/gateway.db');
const cols=db.prepare('PRAGMA table_info(channels)').all().map(c=>c.name);
if(!cols.includes('archived')){db.exec('ALTER TABLE channels ADD COLUMN archived INTEGER NOT NULL DEFAULT 0')}
if(!cols.includes('archived_at')){db.exec('ALTER TABLE channels ADD COLUMN archived_at INTEGER')}
console.log('migrated:',db.prepare('PRAGMA table_info(channels)').all().map(c=>c.name).join(','))"

docker build -t myapi-myapi:latest /root/myapi-new   # 实操建议 nohup 后台构建，防 SSH 断连带走构建
docker tag myapi-myapi:latest myapi-myapi:v-rollback-$(date +%Y%m%d-%H%M)   # 回滚点

# 3) 停机窗口（分钟级）：
docker exec llm-gateway node -e "require('better-sqlite3')('/app/data/gateway.db').pragma('wal_checkpoint(TRUNCATE)')"
docker stop llm-gateway
TS=$(date +%Y%m%d-%H%M)
cp -a /root/myapi/data /opt/backup/gateway-$TS              # 文件级备份（db 三件套）
cp -p /root/myapi/.env /opt/backup/gateway-$TS/env-file    # 一并备份 secret
mv /root/myapi /root/myapi-old-$TS                          # 旧目录整体保留
mv /root/myapi-new /root/myapi
cp -a /opt/backup/gateway-$TS/data /root/myapi/data         # 从备份回填 data
cd /root/myapi && docker compose up -d --no-build           # 镜像已预构建，秒起

# 4) 验证：healthcheck healthy、/login 200、表计数与停机前一致、
#    docker logs 无 "init-db"、容器内 GATEWAY_SECRET 长度 64、
#    grep 新功能标记（Turbopack 产物在 .next/server/chunks/ 下，不在 route.js）
```

- 回滚：`docker tag myapi-myapi:v-rollback-$TS myapi-myapi:latest` → `docker compose up -d --force-recreate`；数据回滚用 `/opt/backup/gateway-$TS/` 覆盖 `/root/myapi/data`
- 旧目录 `/root/myapi-old-$TS` 观察几天无异常后可删

## 回滚

- 单机：保留上一版 `.next` 构建产物或 git tag，切回后重启进程即可
- 数据回滚：还原最近导出的备份 JSON（注意是整库覆盖）

## 更新规则

- 部署流程 / 环境变量 / 平台配置 / 回滚方式发生变化时 → 同步更新本文件
