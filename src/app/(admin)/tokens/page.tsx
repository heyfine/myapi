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
                <td className="td font-mono text-xs">{t.keyPrefix}••••••••</td>
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
