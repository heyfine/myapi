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

## 回滚

- 单机：保留上一版 `.next` 构建产物或 git tag，切回后重启进程即可
- 数据回滚：还原最近导出的备份 JSON（注意是整库覆盖）

## 更新规则

- 部署流程 / 环境变量 / 平台配置 / 回滚方式发生变化时 → 同步更新本文件
