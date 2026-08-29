"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, time, usd } from "@/lib/client-utils";

type Log = {
  id: number;
  channelName: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  thinkingTokens: number;
  usageSource: number;
  hasUsageDetails: number;
  cost: number;
  latencyMs: number;
  status: number;
  errorMsg: string | null;
  createdAt: string;
};

export default function LogsPage() {
  const [list, setList] = useState<Log[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const pageSize = 20;

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (model) params.set("model", model);
    api<{ data: Log[]; total: number }>(`/api/logs?${params}`)
      .then((d) => {
        setList(d.data);
        setTotal(d.total);
      })
      .catch((e) => setError(e.message));
  }, [page, model]);
  useEffect(load, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">调用日志</h1>
      {error && <div className="text-red-600 text-sm">{error}</div>}

      <div className="card flex items-end gap-3">
        <div>
          <label className="label">模型筛选</label>
          <input className="input w-56" value={model} onChange={(e) => setModel(e.target.value)} placeholder="如 deepseek-chat" />
        </div>
        <div className="text-sm text-gray-500 pb-2">共 {total} 条记录</div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[960px]">
          <thead>
            <tr>
              <th className="th">时间</th>
              <th className="th">渠道</th>
              <th className="th">模型</th>
              <th className="th">输入 / 输出 Tokens</th>
              <th className="th">缓存/推理/思考</th>
              <th className="th">消费</th>
              <th className="th">耗时</th>
              <th className="th">状态</th>
            </tr>
          </thead>
          <tbody>
            {list.map((l) => (
              <tr key={l.id}>
                <td className="td whitespace-nowrap">{time(l.createdAt)}</td>
                <td className="td">{l.channelName ?? "-"}</td>
                <td className="td font-mono text-xs">
                  {l.model ? (
                    <Link href={`/model-detail?model=${encodeURIComponent(l.model)}`} className="text-blue-600 hover:underline" title="查看模型详情">
                      {l.model}
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="td">
                  {l.promptTokens} / {l.completionTokens}
                </td>
                <td className="td font-mono text-xs text-gray-500">
                  {l.usageSource === 2 ? (
                    <span className="badge bg-amber-100 text-amber-700" title="上游未返回 usage，token 数为估算值">
                      估算
                    </span>
                  ) : l.hasUsageDetails === 0 ? (
                    <span
                      className={l.usageSource === 0 ? "" : "cursor-help"}
                      title={l.usageSource === 0 ? "旧数据，未记录明细标记" : "上游未返回缓存/推理明细字段"}
                    >
                      {l.cachedTokens || l.reasoningTokens || l.thinkingTokens
                        ? `${l.cachedTokens} / ${l.reasoningTokens} / ${l.thinkingTokens}`
                        : l.usageSource === 0
                          ? "-"
                          : "未返回"}
                    </span>
                  ) : (
                    `${l.cachedTokens} / ${l.reasoningTokens} / ${l.thinkingTokens}`
                  )}
                </td>
                <td className="td">${usd(l.cost)}</td>
                <td className="td">{(l.latencyMs / 1000).toFixed(2)}s</td>
                <td className="td">
                  {l.status === 200 ? (
                    <span className="badge bg-green-100 text-green-700">200</span>
                  ) : (
                    <span className="badge bg-red-100 text-red-700" title={l.errorMsg ?? ""}>
                      {l.status}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td className="td text-gray-400" colSpan={8}>
                  暂无日志
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <span className="text-gray-500">
          第 {page} / {totalPages} 页
        </span>
        <button className="btn-ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
          下一页
        </button>
      </div>
    </div>
  );
}
