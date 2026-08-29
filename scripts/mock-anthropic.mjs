// mock Anthropic 上游：验证网关的 Claude -> OpenAI 协议互转
import http from "node:http";

const PORT = 3789;

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const data = JSON.parse(body || "{}");
      const id = "msg_mock_anthropic_" + Date.now();
      if (!req.url?.includes("/v1/messages")) {
        res.writeHead(404).end("not found");
        return;
      }
      if (data.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const events = [
          { type: "message_start", message: { id, usage: { input_tokens: 13 } } },
          { type: "content_block_delta", delta: { type: "text_delta", text: "Claude mock 回复" } },
          { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 6 } },
          { type: "message_stop" },
        ];
        let i = 0;
        const timer = setInterval(() => {
          if (i < events.length) {
            res.write(`data: ${JSON.stringify(events[i])}\n\n`);
            i++;
          } else {
            res.end();
            clearInterval(timer);
          }
        }, 30);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id,
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Claude mock 回复" }],
          model: data.model,
          stop_reason: "end_turn",
          usage: { input_tokens: 13, output_tokens: 6 },
        }),
      );
    });
  })
  .listen(PORT, () => console.log(`mock anthropic listening on ${PORT}`));
