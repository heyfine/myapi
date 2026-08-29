// 本地 mock HTTP 代理：验证网关的代理转发功能
// 支持：绝对地址形式的 HTTP 转发 + CONNECT 隧道（https）
import net from "node:net";
import http from "node:http";

const PORT = 3890;
let hits = 0;

const server = http.createServer((req, res) => {
  hits++;
  console.log(`[proxy] 第 ${hits} 次转发: ${req.method} ${req.url}`);
  const url = new URL(req.url);
  const preq = http.request(
    {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: req.method,
      headers: { ...req.headers, host: url.host },
    },
    (pres) => {
      res.writeHead(pres.statusCode, pres.headers);
      pres.pipe(res);
    },
  );
  preq.on("error", () => {
    res.writeHead(502).end("proxy upstream error");
  });
  req.pipe(preq);
});

server.on("connect", (req, socket, head) => {
  hits++;
  console.log(`[proxy] 第 ${hits} 次 CONNECT 隧道: ${req.url}`);
  const [host, port] = req.url.split(":");
  const s = net.connect(Number(port) || 443, host, () => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) s.write(head);
    socket.pipe(s);
    s.pipe(socket);
  });
  s.on("error", () => socket.destroy());
  socket.on("error", () => s.destroy());
});

server.listen(PORT, () => console.log(`mock proxy listening on ${PORT}`));
