"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, usd, time } from "@/lib/client-utils";
import TrendChart, { type TrendPoint } from "@/components/TrendChart";
import UsageTable from "@/components/UsageTable";

type Agg = {
  total: number;
  success: number;
  cost: number;
  avgLatency: number;
  maxLatency: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  thinkingTokens: number;
  detailMissing: number;
  estimatedCount: number;
};

type ModelStats = {
  model: string;
  range: string;
  agg: Agg;
  byChannel: Array<{ channelName: string | null; total: number; success: number; cost: number; avgLatency: number; promptTokens: number; completionTokens: number; cachedTokens: number; reasoningTokens: number; thinkingTokens: number }>;
  providers: Array<{ id: number; name: string; type: string; baseUrl: string; proxy: string; priority: number; weight: number; status: number }>;
  daily: TrendPoint[];
  hourly: TrendPoint[];
  minutely: TrendPoint[];
};

type Log = {
  id: number;
  channelName: string | null;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  thinkingTokens: number;
  cost: number;
  latencyMs: number;
  status: number;
  errorMsg: string | null;
  createdAt: string;
};

const RANGES = [
  { key: "all", label: "全部" },
  { key: "24h", label: "近 24 小时" },
  { key: "7d", label: "近 7 天" },
];

const TYPE_LABELS: Record<string, string> = {
  openai: "OpenAI 官方",
  "openai-compatible": "OpenAI 兼容",
  anthropic: "Anthropic (Claude)",
  gemini: "Google Gemini",
};

function fmt(n: number): string {
  return n.toLocaleString("zh-CN");
}

/** 轮询间隔：与仪表盘一致；再短会让 VChart 反复重绘 */
const POLL_INTERVAL = 5000;

function ModelDetailInner() {
  const searchParams = useSearchParams();
  const model = searchParams.get("model") ?? "";
  const [range, setRange] = useState("all");
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [recentLogs, setRecentLogs] = useState<Log[]>([]);
  const [logPage, setLogPage] = useState(1);
  const [logTotal, setLogTotal] = useState(0);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(() => {
    if (!model) return;
    const seq = ++seqRef.current;
    api<ModelStats>(`/api/model-stats?model=${encodeURIComponent(model)}&range=${range}`)
      .then((d) => {
        if (seq !== seqRef.current) return;
        setStats(d);
        setUpdatedAt(new Date());
        setError("");
      })
      .catch((e) => {
        if (seq !== seqRef.current) return;
        setError(e.message);
      });
    api<{ data: Log[]; total: number }>(
      `/api/logs?model=${encodeURIComponent(model)}&page=${logPage}&pageSize=30`,
    )
      .then((d) => {
        if (seq !== seqRef.current) return;
        setRecentLogs(d.data);
        setLogTotal(d.total);
      })
      .catch(() => {});
  }, [model, range, logPage]);

  // 5s 轮询：不可见时跳过；切回可见立即刷新；请求序号防旧响应覆盖新状态
  useEffect(() => {
    let alive = true;
    function tick(): void {
      if (document.visibilityState !== "visible") return;
      load();
    }
    tick();
    const timer = setInterval(tick, POLL_INTERVAL);
    function onVisibilityChange(): void {
      if (document.visibilityState === "visible") tick();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load]);

  if (!model) {
    return <div className="text-sm text-gray-500">缺少 model 参数，请从仪表盘或日志页点击模型名进入。</div>;
  }

  const agg = stats?.agg;
  const successRate = agg && agg.total > 0 ? ((agg.success / agg.total) * 100).toFixed(1) + "%" : "-";
  const cards = agg
    ? [
        { label: "调用次数", value: fmt(agg.total) },
        { label: "成功率", value: successRate },
        { label: "消费", value: `$${usd(agg.cost)}` },
        { label: "平均耗时", value: (agg.avgLatency / 1000).toFixed(2) + "s" },
        { label: "最大耗时", value: (agg.maxLatency / 1000).toFixed(2) + "s" },
        { label: "总 Tokens", value: fmt(agg.promptTokens + agg.completionTokens) },
      ]
    : [];
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
          ← 仪表盘
        </Link>
        <h1 className="text-xl font-bold font-mono">{model}</h1>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs ml-auto">
          {RANGES.map((rg) => (
            <button key={rg.key} onClick={() => setRange(rg.key)}
              className={`px-3 py-1 cursor-pointer ${range === rg.key ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              {rg.label}
            </button>
          ))}
        </div>
        <div className="text-xs text-gray-400">
          {error && stats ? "刷新失败，保留上次数据" : `每 ${POLL_INTERVAL / 1000} 秒自动刷新${updatedAt ? ` · 更新于 ${updatedAt.toLocaleTimeString("zh-CN", { hour12: false })}` : ""}`}
        </div>
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}

      {/* 核心指标 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="card">
            <div className="text-xs text-gray-500">{c.label}</div>
            <div className="text-lg font-semibold mt-1 truncate font-mono" title={c.value}>
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {/* Token 明细 */}
      <div className="card">
        <div className="font-semibold mb-3">Token 明细</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 输入：含缓存命中/未命中细分 */}
          <div className="rounded-xl border border-dashed border-indigo-200 bg-gradient-to-br from-indigo-50/70 to-white px-4 py-4 text-center">
            <div className="text-sm text-indigo-500/90" title="发给上游的全部输入（含缓存部分）">输入</div>
            <div className="text-2xl font-semibold font-mono mt-1 text-indigo-600">{fmt(agg?.promptTokens ?? 0)}</div>
            <div className="flex justify-center gap-6 mt-3 text-xs text-gray-600 flex-wrap">
              <span title="输入中命中上游缓存的部分">缓存命中 <span className="font-mono font-medium text-emerald-600">{fmt(agg?.cachedTokens ?? 0)}</span></span>
              <span title="输入中未命中缓存的部分（= 输入 - 缓存命中），按正常输入价计费">缓存未命中 <span className="font-mono font-medium text-orange-500">{fmt(Math.max(0, (agg?.promptTokens ?? 0) - (agg?.cachedTokens ?? 0)))}</span></span>
            </div>
          </div>
          {/* 输出：含推理/回答细分 */}
          <div className="rounded-xl border border-dashed border-violet-200 bg-gradient-to-br from-violet-50/70 to-white px-4 py-4 text-center">
            <div className="text-sm text-violet-500/90" title="上游生成的全部输出">输出</div>
            <div className="text-2xl font-semibold font-mono mt-1 text-violet-600">{fmt(agg?.completionTokens ?? 0)}</div>
            <div className="flex justify-center gap-6 mt-3 text-xs text-gray-600 flex-wrap">
              <span title="模型的思考过程（reasoning / thoughts tokens 合计）">推理 <span className="font-mono font-medium text-fuchsia-600">{fmt((agg?.reasoningTokens ?? 0) + (agg?.thinkingTokens ?? 0))}</span></span>
              <span title="最终回答文本（= 输出 - 推理）">回答 <span className="font-mono font-medium text-sky-600">{fmt(Math.max(0, (agg?.completionTokens ?? 0) - (agg?.reasoningTokens ?? 0) - (agg?.thinkingTokens ?? 0)))}</span></span>
            </div>
          </div>
          {/* 总 Tokens */}
          <div className="rounded-xl border border-dashed border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-white px-4 py-4 text-center">
            <div className="text-sm text-emerald-500/90">总 Tokens</div>
            <div className="text-2xl font-semibold font-mono mt-1 text-emerald-600">{fmt((agg?.promptTokens ?? 0) + (agg?.completionTokens ?? 0))}</div>
            <div className="mt-3 text-xs text-gray-400">= 输入 + 输出</div>
          </div>
        </div>
        <div className="text-xs text-gray-400 mt-3">
          缓存命中包含在输入内，推理包含在输出内；细分数字取决于上游是否返回对应明细字段，未返回时为 0
          {(agg?.detailMissing ?? 0) > 0 && (
            <span className="text-amber-600 font-medium">
              ⚠ 当前范围内有 {fmt(agg!.detailMissing)} 次调用的上游未返回缓存/推理明细，相关细分按 0 统计
            </span>
          )}
          {(agg?.estimatedCount ?? 0) > 0 && (
            <span className="text-amber-600 font-medium">
              {"　"}⚠ 有 {fmt(agg!.estimatedCount)} 次调用上游未返回 usage，token 数为估算值
            </span>
          )}
        </div>
      </div>

      {/* 按渠道统计 */}
      <div className="card overflow-x-auto">
        <div className="font-semibold mb-3">按渠道统计</div>
        <table className="w-full min-w-[760px]">
          <thead>
            <tr>
              <th className="th">渠道</th>
              <th className="th">调用次数</th>
              <th className="th">成功率</th>
              <th className="th">平均耗时</th>
              <th className="th">输入</th>
              <th className="th">输出</th>
              <th className="th">缓存命中</th>
              <th className="th">推理</th>
              <th className="th">消费</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.byChannel ?? []).map((c) => (
              <tr key={c.channelName ?? "-"}>
                <td className="td font-medium">{c.channelName ?? "-"}</td>
                <td className="td">{c.total}</td>
                <td className="td">{c.total > 0 ? ((c.success / c.total) * 100).toFixed(1) + "%" : "-"}</td>
                <td className="td font-mono text-xs">{(c.avgLatency / 1000).toFixed(2)}s</td>
                <td className="td font-mono text-xs">{fmt(c.promptTokens)}</td>
                <td className="td font-mono text-xs">{fmt(c.completionTokens)}</td>
                <td className="td font-mono text-xs">{fmt(c.cachedTokens)}</td>
                <td className="td font-mono text-xs">{fmt(c.reasoningTokens + c.thinkingTokens)}</td>
                <td className="td">${usd(c.cost)}</td>
              </tr>
            ))}
            {stats && stats.byChannel.length === 0 && (
              <tr>
                <td className="td text-gray-400" colSpan={9}>
                  当前范围内暂无调用
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 趋势图：各渠道对比（与仪表盘同款组件，序列维度=渠道） */}
      <div className="card">
        <div className="font-semibold mb-3">趋势（按天 / 按小时 / 按分钟）· 各渠道对比</div>
        {(stats?.daily.length ?? 0) > 0 || (stats?.hourly.length ?? 0) > 0 || (stats?.minutely.length ?? 0) > 0 ? (
          <TrendChart daily={stats?.daily ?? []} hourly={stats?.hourly ?? []} minutely={stats?.minutely ?? []} seriesName="渠道" />
        ) : (
          <div className="text-sm text-gray-400 py-8 text-center">暂无数据</div>
        )}
      </div>

      {/* Token 用量统计（按日期维度，new-api 风格渠道明细表；单模型口径） */}
      <div className="card">
        <div className="font-semibold mb-3">Token 用量统计（按天 / 按月 / 按年 / 自定义）</div>
        <UsageTable model={model} breakdown="channel" />
      </div>

      {/* 供应商渠道（管理员） */}
      {stats && stats.providers.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="font-semibold mb-3">承载该模型的渠道（供应商）</div>
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                <th className="th">渠道名称</th>
                <th className="th">类型</th>
                <th className="th">Base URL</th>
                <th className="th">代理</th>
                <th className="th">优先级</th>
                <th className="th">权重</th>
                <th className="th">状态</th>
              </tr>
            </thead>
            <tbody>
              {stats.providers.map((p) => (
                <tr key={p.id}>
                  <td className="td font-medium">{p.name}</td>
                  <td className="td">{TYPE_LABELS[p.type] ?? p.type}</td>
                  <td className="td font-mono text-xs max-w-[220px] truncate" title={p.baseUrl}>
                    {p.baseUrl}
                  </td>
                  <td className="td">
                    {p.proxy ? (
                      <span className="badge bg-purple-50 text-purple-600 font-mono text-[10px]">
                        {p.proxy.replace(/\/\/[^@]*@/, "//***@")}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs">直连</span>
                    )}
                  </td>
                  <td className="td">{p.priority}</td>
                  <td className="td">{p.weight}</td>
                  <td className="td">
                    <span className={`badge ${p.status ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}`}>
                      {p.status ? "启用" : "停用"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 最近调用 */}
      <div className="card overflow-x-auto">
        <div className="font-semibold mb-3">
          调用记录 <span className="text-xs text-gray-400 font-normal">共 {fmt(logTotal)} 条，每页 30 条（可翻页查看最近 1000 条）</span>
        </div>
        <table className="w-full min-w-[860px]">
          <thead>
            <tr>
              <th className="th">时间</th>
              <th className="th">渠道</th>
              <th className="th">输入 / 输出</th>
              <th className="th">缓存/推理/思考</th>
              <th className="th">消费</th>
              <th className="th">耗时</th>
              <th className="th">状态</th>
            </tr>
          </thead>
          <tbody>
            {recentLogs.map((l) => (
              <tr key={l.id}>
                <td className="td whitespace-nowrap">{time(l.createdAt)}</td>
                <td className="td">{l.channelName ?? "-"}</td>
                <td className="td font-mono text-xs">
                  {fmt(l.promptTokens)} / {fmt(l.completionTokens)}
                </td>
                <td className="td font-mono text-xs text-gray-500">
                  {l.cachedTokens || l.reasoningTokens || l.thinkingTokens
                    ? `${l.cachedTokens} / ${l.reasoningTokens} / ${l.thinkingTokens}`
                    : "-"}
                </td>
                <td className="td">${usd(l.cost)}</td>
                <td className="td font-mono text-xs">{(l.latencyMs / 1000).toFixed(2)}s</td>
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
            {recentLogs.length === 0 && (
              <tr>
                <td className="td text-gray-400" colSpan={7}>
                  暂无调用记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {logTotal > 30 && (
          <div className="flex items-center justify-between mt-3 text-sm">
            <button className="btn-ghost" disabled={logPage <= 1} onClick={() => setLogPage((p) => p - 1)}>
              上一页
            </button>
            <span className="text-gray-500 text-xs">
              第 {logPage} / {Math.ceil(logTotal / 30)} 页
            </span>
            <button
              className="btn-ghost"
              disabled={logPage >= Math.ceil(logTotal / 30)}
              onClick={() => setLogPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ModelDetailPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500">加载中...</div>}>
      <ModelDetailInner />
    </Suspense>
  );
}
