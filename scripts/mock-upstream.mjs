// 本地 mock 上游供应商：模拟 OpenAI 兼容服务，用于端到端联调
import http from "node:http";

const PORT = 3788;

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (!req.url?.includes("/chat/completions")) {
        if (req.url?.includes("/models")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              object: "list",
              data: [
                { id: "deepseek-chat", object: "model" },
                { id: "deepseek-reasoner", object: "model" },
                { id: "deepseek-coder", object: "model" },
              ],
            }),
          );
          return;
        }
        res.writeHead(404).end("not found");
        return;
      }
      const data = JSON.parse(body || "{}");
      const auth = req.headers.authorization || "";
      if (!auth.includes("mock-key-123")) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "bad mock key" } }));
        return;
      }

      if (data.stream) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        const id = "chatcmpl-mock-" + Date.now();
        const chunks = ["你", "好", "，", "来", "自", "mock", " 上游"];
        let i = 0;
        const timer = setInterval(() => {
          if (i < chunks.length) {
            res.write(
              `data: ${JSON.stringify({
                id,
                object: "chat.completion.chunk",
                model: data.model,
                choices: [{ index: 0, delta: { content: chunks[i] }, finish_reason: null }],
              })}\n\n`,
            );
            i++;
          } else {
            res.write(
              `data: ${JSON.stringify({
                id,
                object: "chat.completion.chunk",
                model: data.model,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                usage: {
                  prompt_tokens: 21,
                  completion_tokens: 7,
                  total_tokens: 28,
                  prompt_tokens_details: { cached_tokens: 9 },
                  completion_tokens_details: { reasoning_tokens: 3 },
                },
              })}\n\n`,
            );
            res.write("data: [DONE]\n\n");
            res.end();
            clearInterval(timer);
          }
        }, 40);
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-mock-" + Date.now(),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: data.model,
          system_fingerprint: "mock-received:" + data.model,
          choices: [{ index: 0, message: { role: "assistant", content: "你好，来自 mock 上游" }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 21,
            completion_tokens: 7,
            total_tokens: 28,
            prompt_tokens_details: { cached_tokens: 9 },
            completion_tokens_details: { reasoning_tokens: 3 },
          },
        }),
      );
    });
  })
  .listen(PORT, () => console.log(`mock upstream listening on ${PORT}`));
