"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-utils";

type Price = { model: string; inputPrice: number; outputPrice: number };

export default function PricingPage() {
  const [list, setList] = useState<Price[]>([]);
  const [draft, setDraft] = useState({ model: "", inputUsd: 0, outputUsd: 0 });
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<{ data: Price[] }>("/api/pricing")
      .then((d) => setList(d.data))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function upsert(model: string, inputUsd: number, outputUsd: number) {
    try {
      await api("/api/pricing", { method: "POST", body: JSON.stringify({ items: [{ model, inputUsd, outputUsd }] }) });
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function remove(model: string) {
    if (!confirm(`确认删除模型 ${model} 的定价？`)) return;
    await api(`/api/pricing?model=${encodeURIComponent(model)}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">模型定价</h1>
        <p className="text-sm text-gray-500 mt-1">单价为每百万 Token 的美元价格；未配置定价的模型调用不产生费用。</p>
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}

      <div className="card space-y-3">
        <div className="font-semibold text-sm">添加 / 更新定价</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label">模型名</label>
            <input className="input font-mono text-xs" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="deepseek-chat" />
          </div>
          <div>
            <label className="label">输入 $ / 1M tokens</label>
            <input className="input" type="number" step="0.01" min={0} value={draft.inputUsd} onChange={(e) => setDraft({ ...draft, inputUsd: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">输出 $ / 1M tokens</label>
            <input className="input" type="number" step="0.01" min={0} value={draft.outputUsd} onChange={(e) => setDraft({ ...draft, outputUsd: Number(e.target.value) })} />
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full" onClick={() => draft.model && upsert(draft.model, draft.inputUsd, draft.outputUsd)}>
              保存
            </button>
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr>
              <th className="th">模型</th>
              <th className="th">输入单价 ($/1M)</th>
              <th className="th">输出单价 ($/1M)</th>
              <th className="th">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.model}>
                <td className="td font-mono text-xs">{p.model}</td>
                <td className="td">{(p.inputPrice / 100000).toFixed(4)}</td>
                <td className="td">{(p.outputPrice / 100000).toFixed(4)}</td>
                <td className="td">
                  <button className="text-red-500 text-sm hover:underline cursor-pointer" onClick={() => remove(p.model)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td className="td text-gray-400" colSpan={4}>
                  暂无定价
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
