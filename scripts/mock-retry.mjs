// mock 上游：前 2 次 /chat/completions 返回 429，之后成功。用于验证网关失败重连规则。
import http from "node:http";

const PORT = 3790;
let hits = 0;

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (!req.url?.includes("/chat/completions")) {
        res.writeHead(404).end("not found");
        return;
      }
      hits++;
      const data = JSON.parse(body || "{}");
      if (hits <= 2) {
        console.log(`第 ${hits} 次请求 -> 429`);
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "mock rate limited" } }));
        return;
      }
      console.log(`第 ${hits} 次请求 -> 200`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-retry-mock-" + Date.now(),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: data.model,
          choices: [{ index: 0, message: { role: "assistant", content: "重试后成功" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        }),
      );
    });
  })
  .listen(PORT, () => console.log(`retry mock listening on ${PORT}`));
