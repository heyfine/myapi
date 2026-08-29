// 渠道代理支持：按代理地址缓存 Dispatcher，http(s) 代理用 ProxyAgent，socks 用自定义连接器
import { ProxyAgent, Agent, buildConnector, fetch as undiciFetch, type Dispatcher } from "undici";
import { SocksClient } from "socks";

const dispatchers = new Map<string, Dispatcher>();

export const PROXY_PROTOCOLS = ["http:", "https:", "socks5:", "socks5h:", "socks4:"];

/** 解析并校验代理地址，返回 null 表示不使用代理；非法格式抛错 */
export function parseProxyUrl(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const parsed = new URL(raw); // 非法 URL 会抛出
  if (!PROXY_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(`不支持的代理协议「${parsed.protocol.replace(":", "")}」，支持 http/https/socks5/socks4`);
  }
  return raw;
}

/** 获取（或缓存）代理 Dispatcher */
export function getDispatcher(proxy: string): Dispatcher {
  const hit = dispatchers.get(proxy);
  if (hit) return hit;

  const parsed = new URL(proxy);
  let d: Dispatcher;

  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    d = new ProxyAgent({
      uri: `${parsed.protocol}//${parsed.host}`,
      token:
        parsed.username || parsed.password
          ? `Basic ${Buffer.from(`${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`).toString("base64")}`
          : undefined,
    });
  } else {
    // socks5/socks5h/socks4：通过 SocksClient 建立隧道后交给 undici TLS 连接器
    const type = parsed.protocol === "socks4:" ? 4 : 5;
    const connect = buildConnector({});
    d = new Agent({
      connect: async (opts, cb) => {
        try {
          const { socket } = await SocksClient.createConnection({
            proxy: {
              host: parsed.hostname,
              port: Number(parsed.port) || 1080,
              type: type as 4 | 5,
              userId: parsed.username ? decodeURIComponent(parsed.username) : undefined,
              password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
            },
            command: "connect",
            destination: {
              host: String(opts.hostname),
              port: Number(opts.port) || (opts.protocol === "https:" ? 443 : 80),
            },
          });
          connect({ ...opts, httpSocket: socket }, cb);
        } catch (err) {
          cb(err as Error, null);
        }
      },
    });
  }

  dispatchers.set(proxy, d);
  return d;
}

/** 带代理的 fetch：proxy 为空时走直连 */
export async function proxiedFetch(url: string, init: RequestInit, proxy?: string | null): Promise<Response> {
  const trimmed = (proxy ?? "").trim();
  if (!trimmed) return fetch(url, init);
  const dispatcher = getDispatcher(trimmed);
  const res = await undiciFetch(url, { ...init, dispatcher } as never);
  return res as unknown as Response;
}
