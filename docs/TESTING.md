# 测试指南

## 当前状态

项目**尚未引入测试框架**（无 vitest/jest）。目前的验证方式是"脚本 + mock 服务 + curl 实测"，全部通过真实 HTTP 调用完成。

## 手动验证流程（当前约定）

1. 启动网关：`npm run dev`（3777）
2. 启动需要的 mock 上游：
   - `node scripts/mock-upstream.mjs`（3788，OpenAI 兼容，回显收到的模型名 + 带 usage 明细）
   - `node scripts/mock-anthropic.mjs`（3789，Claude 协议）
   - `node scripts/mock-retry.mjs`（3790，先 429 两次后成功）
   - `node scripts/mock-proxy.mjs`（3890，HTTP 代理，含命中日志）
3. 管理后台（或 node fetch 脚本）建渠道指向 mock → 签发令牌
4. curl 验证网关端点（非流式/流式/模型列表/嵌入），再查 /api/stats 与 /api/logs 对账

## 引入 vitest 时的规划（TODO 中已排期）

```bash
npm install -D vitest
npx vitest            # 跑全部测试
npx vitest <文件名>    # 只跑某个文件
```

- 优先覆盖（纯函数、收益最大）：
  - `src/lib/gateway/anthropic-adapter.ts` / `gemini-adapter.ts`：请求/响应/流式转换
  - `src/lib/gateway/retry.ts`：computeRetryDelay（首等/翻倍/上限/抖动边界）
  - `src/lib/gateway/billing.ts`：computeCost
- 写测试的约定（提前定好）：
  - 修 bug 必加回归测试：先写能稳定复现的用例，修复后必须通过
  - 不打真实外部服务，协议转换用固定 JSON 快照
  - 测试文件与被测代码同目录（`xxx.test.ts`）

## 更新规则

- 引入测试框架 / 命令 / 覆盖率要求变化时 → 同步更新本文件
