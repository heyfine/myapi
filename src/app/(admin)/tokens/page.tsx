"use client";

import { useCallback, useEffect, useState } from "react";
import { api, time } from "@/lib/client-utils";

type Token = {
  id: number;
  name: string;
  keyPrefix: string;
  quotaLimit: number;
  usedQuota: number;
  expiredAt: string | null;
  status: number;
  createdAt: string;
};

export default function TokensPage() {
  const [list, setList] = useState<Token[]>([]);
  const [error, setError] = useState("");
  const [newKey, setNewKey] = useState("");
  const [form, setForm] = useState({ name: "", quotaLimitUsd: 0, expiredDays: 0 });
  const [apiOrigin, setApiOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [tokenKeys, setTokenKeys] = useState<Record<number, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<number, boolean>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    setApiOrigin(window.location.origin);
  }, []);

  /** 取回令牌完整 Key（加密存储，按需解密） */
  async function loadKey(t: Token): Promise<string | null> {
    if (tokenKeys[t.id]) return tokenKeys[t.id];
    try {
      const res = await api<{ key: string }>(`/api/tokens/${t.id}/key`);
      setTokenKeys((prev) => ({ ...prev, [t.id]: res.key }));
      return res.key;
    } catch (e) {
      alert((e as Error).message);
      return null;
    }
  }

  async function toggleKey(t: Token) {
    if (visibleKeys[t.id]) {
      setVisibleKeys((prev) => ({ ...prev, [t.id]: false }));
      return;
    }
    const key = await loadKey(t);
    if (key) setVisibleKeys((prev) => ({ ...prev, [t.id]: true }));
  }

  async function copyKey(t: Token) {
    const key = await loadKey(t);
    if (!key) return;
    navigator.clipboard.writeText(key);
    setCopiedId(t.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  const load = useCallback(() => {
    api<{ data: Token[] }>("/api/tokens")
      .then((d) => setList(d.data))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function create() {
    try {
      const res = await api<{ key: string }>("/api/tokens", { method: "POST", body: JSON.stringify(form) });
      setNewKey(res.key);
      setForm({ name: "", quotaLimitUsd: 0, expiredDays: 0 });
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function toggle(t: Token) {
    await api(`/api/tokens/${t.id}`, { method: "PATCH", body: JSON.stringify({ status: t.status ? 0 : 1 }) });
    load();
  }

  async function remove(t: Token) {
    if (!confirm(`确认删除令牌「${t.name}」？`)) return;
    await api(`/api/tokens/${t.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">API 令牌</h1>
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}

      {/* API 接口地址 */}
      <div className="card !p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-semibold">API 接口地址（OpenAI 兼容）</div>
            <div className="text-xs text-gray-400 mt-0.5">
              调用方把 OpenAI SDK 的 base_url 设为下面的地址，API Key 使用本页签发的令牌
            </div>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <code className="font-mono text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 truncate">
              {apiOrigin ? `${apiOrigin}/v1` : "加载中..."}
            </code>
            <button
              className="btn-ghost !py-1.5 !px-2 text-xs shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(`${apiOrigin}/v1`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "已复制" : "复制"}
            </button>
          </div>
        </div>
      </div>

      {newKey && (
        <div className="card border-blue-300 bg-blue-50">
          <div className="font-semibold text-sm mb-2">令牌已创建，完整 Key 只显示一次，请立即复制：</div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm bg-white border rounded-lg px-3 py-2 flex-1 break-all">{newKey}</code>
            <button
              className="btn-primary"
              onClick={() => {
                navigator.clipboard.writeText(newKey);
                alert("已复制");
              }}
            >
              复制
            </button>
            <button className="btn-ghost" onClick={() => setNewKey("")}>
              关闭
            </button>
          </div>
        </div>
      )}

      <div className="card space-y-3">
        <div className="font-semibold text-sm">创建新令牌</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label">名称</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 my-app" />
          </div>
          <div>
            <label className="label">额度上限（美元，0 = 不限）</label>
            <input className="input" type="number" min={0} value={form.quotaLimitUsd} onChange={(e) => setForm({ ...form, quotaLimitUsd: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">有效期（天，0 = 永久）</label>
            <input className="input" type="number" min={0} value={form.expiredDays} onChange={(e) => setForm({ ...form, expiredDays: Number(e.target.value) })} />
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full" onClick={create}>
              创建令牌
            </button>
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[800px]">
          <thead>
            <tr>
              <th className="th">名称</th>
              <th className="th">Key</th>
              <th className="th">已用 / 上限</th>
              <th className="th">过期时间</th>
              <th className="th">状态</th>
              <th className="th">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <td className="td font-medium">{t.name}</td>
                <td className="td font-mono text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="max-w-[280px] truncate" title={visibleKeys[t.id] ? tokenKeys[t.id] : `完整 Key：${t.keyPrefix}...（点眼睛查看）`}>
                      {visibleKeys[t.id] && tokenKeys[t.id]
                        ? tokenKeys[t.id]
                        : `${t.keyPrefix}••••••••••••`}
                    </span>
                    <button
                      className="text-gray-400 hover:text-gray-600 cursor-pointer shrink-0"
                      title={visibleKeys[t.id] ? "隐藏 Key" : "查看 Key"}
                      onClick={() => toggleKey(t)}
                    >
                      {visibleKeys[t.id] ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                    <button
                      className="text-gray-400 hover:text-indigo-600 cursor-pointer shrink-0"
                      title="复制完整 Key"
                      onClick={() => copyKey(t)}
                    >
                      {copiedId === t.id ? (
                        <span className="text-emerald-600 text-xs font-medium">已复制</span>
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </div>
                </td>
                <td className="td">
                  ${((t.usedQuota ?? 0) / 100000).toFixed(4)}
                  {t.quotaLimit > 0 ? ` / $${(t.quotaLimit / 100000).toFixed(2)}` : " / 不限"}
                </td>
                <td className="td">{t.expiredAt ? time(t.expiredAt) : "永久"}</td>
                <td className="td">
                  <span className={`badge ${t.status ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}`}>
                    {t.status ? "启用" : "禁用"}
                  </span>
                </td>
                <td className="td space-x-2 whitespace-nowrap">
                  <button className="text-gray-500 text-sm hover:underline cursor-pointer" onClick={() => toggle(t)}>
                    {t.status ? "禁用" : "启用"}
                  </button>
                  <button className="text-red-500 text-sm hover:underline cursor-pointer" onClick={() => remove(t)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td className="td text-gray-400" colSpan={6}>
                  还没有令牌，用上方表单创建一个
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
