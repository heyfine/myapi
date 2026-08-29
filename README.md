# LLM 网关 · 模型统一接入平台

自研的类 New API 模型网关：集中管理多家模型供应商，对外暴露统一的 OpenAI 兼容接口，内置令牌签发、渠道路由与故障转移、计费扣费、调用日志与多用户体系。

> 📖 **完整部署与使用手册见 [`docs/使用手册.md`](docs/使用手册.md)**（覆盖一键启动、Docker 部署、渠道管理、获取模型、API 令牌、调用示例、重试规则、备份还原、仪表盘解读等全部操作流程）

## 技术栈

- Next.js 16（App Router）+ TypeScript + Tailwind CSS
- SQLite（better-sqlite3）+ Drizzle ORM
- 无其他运行时依赖，单进程部署

## 快速开始

### 方式一：一键启动（推荐，Windows）

双击项目目录下的 **`一键启动.bat`**，脚本会自动：

1. 检查 Node.js 是否安装（未装会提示去 https://nodejs.org/ 下载）
2. 首次运行自动安装依赖（约 1-2 分钟）
3. 首次运行自动初始化数据库并创建管理员（admin / admin123）
4. 启动服务并自动打开浏览器 http://localhost:3777

停止服务：在黑色控制台窗口按 `Ctrl+C` 或直接关闭窗口。

### 方式二：手动命令行

```bash
cd E:\项目\api调用
npm install       # 首次运行
npm run db:init   # 首次运行，建库 + 种子管理员 + 默认定价
npm run dev       # 开发模式，http://localhost:3777
```

生产环境建议（性能更好）：

```bash
npm run build     # 只需构建一次
npm start         # 以后每次用这条启动
```

### 方式三：Docker 部署（推荐服务器使用）

仓库内置多阶段 `Dockerfile` 与 `docker-compose.yml`，构建即所得，无需手动装 Node 环境：

```bash
# 方式 A：从源码构建（本地）
GATEWAY_SECRET=你的强随机密钥 docker compose up -d --build

# 方式 B：直接拉取已发布的镜像（GitHub Container Registry）
docker pull ghcr.io/heyfine/myapi:latest
docker run -d --name llm-gateway --restart unless-stopped \
  -p 3777:3777 -v /你的数据目录:/app/data \
  -e GATEWAY_SECRET=你的强随机密钥 ghcr.io/heyfine/myapi:latest
```

> 镜像由 GitHub Actions 在每次打 `v*` 版本标签时自动构建发布到 ghcr.io（免费，无需 Docker Hub 账号）。发布说明见 https://github.com/heyfine/myapi/releases

部署要点：

- **首次启动自动建库**（种子管理员 admin/admin123、默认定价与重试规则），无需手动 `db:init`
- **数据持久化**：宿主机目录挂载到容器 `/app/data`（数据库在里面），升级镜像不丢数据
- 换新镜像后如需补数据库迁移：`docker compose exec myapi npx tsx scripts/init-db.ts`（幂等，只补缺失列）
- 停止：`docker compose down`；查看日志：`docker compose logs -f`
- 反向代理用 Nginx/Caddy 时，**流式响应记得关缓冲**：`proxy_buffering off;`

### 注意事项

- 所有数据保存在 `data\gateway.db`，重启服务不丢数据；换电脑用"备份还原"页面迁移
- 终端窗口需保持开启，关掉即停止服务
- 如报 `EADDRINUSE` 说明已有一个实例在运行，直接访问 http://localhost:3777 即可
- 生产部署务必把 `.env` 里的 `GATEWAY_SECRET` 改为强随机值（修改后已保存的渠道密钥将无法解密，需重新填写）

### 环境变量（可复制 `.env.example` 为 `.env`）

- `GATEWAY_SECRET`：渠道 API Key 加密主密钥，**生产环境务必改为强随机值**

## 使用流程

1. 用 `admin / admin123` 登录，进入 **渠道管理** 添加供应商渠道：
   - 类型支持 `OpenAI 官方`、`OpenAI 兼容`（DeepSeek / 智谱 / 月之暗面等）、`Anthropic (Claude)`、`Google Gemini`
   - Base URL 只填到域名（如 `https://api.deepseek.com`），网关自动拼接路径
   - 支持设置优先级（越大越优先）与权重（同优先级内加权随机），可用"连通测试"按钮验证
2. 在 **API 令牌** 页签发 `sk-` 令牌（可设额度上限与有效期，完整 Key 只显示一次）
3. 调用方按 OpenAI SDK 方式接入，`base_url` 指向本站：

```bash
curl http://localhost:3777/v1/chat/completions \
  -H "Authorization: Bearer sk-xxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}],"stream":true}'
```

兼容端点：`/v1/chat/completions`（流式/非流式）、`/v1/models`、`/v1/embeddings`。

## 功能一览

- **统一转发**：无论上游是 OpenAI / Claude / Gemini 格式，对外全部是 OpenAI 兼容协议，流式响应实时转换
- **渠道路由**：按模型选渠道，优先级 + 权重负载均衡，上游 429/5xx 自动切换下一渠道（最多尝试 3 个）
- **计费**：按模型定价（每百万 token 输入/输出单价）从用户余额与令牌额度中扣减；优先使用上游 usage，缺失时估算
- **日志与统计**：每次调用记录渠道、模型、token 数、费用、耗时、状态；仪表盘展示总量、成功率与近 24h 模型用量
- **多用户**：管理员可创建用户、充值额度、禁用账号；普通用户可管理自己的令牌并查看自己的用量

## 目录结构

```
src/
  app/
    (admin)/          # 登录后的后台页面（仪表盘/渠道/令牌/日志/用户/定价）
    api/              # 管理后台 REST API
    v1/               # OpenAI 兼容网关端点
    login/            # 登录页
  lib/
    gateway/          # 网关核心：路由 failover、协议适配、计费、日志
    schema.ts         # 数据库 schema
    auth.ts crypto.ts # 会话与加密
scripts/
  init-db.ts          # 建库与种子数据
  mock-upstream.mjs   # 本地联调用的 mock OpenAI 兼容上游
  mock-anthropic.mjs  # 本地联调用的 mock Anthropic 上游
```

## 额度与计费说明

- 内部额度单位：1 美元 = 100000（整数，避免浮点误差）
- 定价单位：每百万 token 的美元单价，在 **模型定价** 页维护；未配置定价的模型不扣费
- 每次调用优先读取上游返回的 usage；流式调用会在流结束时补发 usage 并记账

## 首期未包含（后续可迭代）

支付充值/兑换码、限流、模型映射规则引擎、渠道自动禁用、Gemini 之外的非 OpenAI 格式嵌入模型。
