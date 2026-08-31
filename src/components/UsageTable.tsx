"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-utils";

/**
 * Token 用量统计表：按天/按月/按年 + 自定义日期范围。
 * breakdown="channel" 时渲染 new-api 风格明细：日期分组 + 渠道子行 + 缓存/推理细分 + 渠道内累计。
 * 仪表盘（全模型平铺）与模型详情页（单模型渠道明细）共用；5s 轮询随页面节奏。
 */

const POLL_INTERVAL = 5000;

export interface UsageRow {
  date: string;
  count: number;
  success: number;
  cost: number;
  promptTokens: number;
  completionTokens: number;
}

interface ChannelUsageRow extends UsageRow {
  channel: string | null;
  cachedTokens: number;
  reasoningTokens: number;
}

interface UsageResp {
  granularity: string;
  from: string | null;
  to: string | null;
  model: string | null;
  breakdown: "none";
  rows: UsageRow[];
  total: Omit<UsageRow, "date">;
}

interface ChannelUsageResp {
  granularity: string;
  from: string | null;
  to: string | null;
  model: string | null;
  breakdown: "channel";
  rows: ChannelUsageRow[];
  total: Omit<ChannelUsageRow, "date" | "channel">;
}

type Mode = "day" | "month" | "year" | "custom";

const MODES: Array<{ key: Mode; label: string }> = [
  { key: "day", label: "按天" },
  { key: "month", label: "按月" },
  { key: "year", label: "按年" },
  { key: "custom", label: "自定义" },
];

function fmt(n: number): string {
  return n.toLocaleString("zh-CN");
}

function usd(n: number): string {
  return `$${(n / 100000).toFixed(4).replace(/\.?0+$/, "") || "0"}`;
}

function defaultWindow(mode: Mode, now = new Date()): { from: string; to: string; granularity: "day" | "month" | "year" } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (mode === "month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    return { from: iso(start), to: iso(now), granularity: "month" };
  }
  if (mode === "year") {
    return { from: "2000-01-01", to: iso(now), granularity: "year" };
  }
  // custom 默认也按天粒度、近 30 天
  const start = new Date(now);
  start.setDate(start.getDate() - 29);
  return { from: iso(start), to: iso(now), granularity: "day" };
}

export default function UsageTable({ model, breakdown }: { model?: string; breakdown?: "channel" }) {
  const [mode, setMode] = useState<Mode>("day");
  const [customFrom, setCustomFrom] = useState<string>(() => defaultWindow("custom").from);
  const [customTo, setCustomTo] = useState<string>(() => defaultWindow("custom").to);
  const [customGran, setCustomGran] = useState<"day" | "month" | "year">("day");
  const [data, setData] = useState<UsageResp | ChannelUsageResp | null>(null);
  const [error, setError] = useState("");
  const seqRef = useRef(0);

  const query = useCallback((): string => {
    const w = mode === "custom" ? { from: customFrom, to: customTo, granularity: customGran } : defaultWindow(mode);
    const p = new URLSearchParams({ granularity: w.granularity, from: w.from, to: w.to });
    if (model) p.set("model", model);
    if (breakdown === "channel") p.set("breakdown", "channel");
    return `/api/usage?${p.toString()}`;
  }, [mode, customFrom, customTo, customGran, model, breakdown]);

  const load = useCallback(() => {
    const seq = ++seqRef.current;
    api<UsageResp | ChannelUsageResp>(query())
      .then((d) => {
        if (seq !== seqRef.current) return;
        setData(d);
        setError("");
      })
      .catch((e) => {
        if (seq !== seqRef.current) return;
        setError(e.message);
      });
  }, [query]);

  // 5s 轮询：可见性门控 + 请求序号
  useEffect(() => {
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
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load]);

  const gran = mode === "custom" ? customGran : mode === "day" ? "day" : mode === "month" ? "month" : "year";
  const dateColTitle = { day: "日期", month: "月份", year: "年份" }[gran];
  const chData = breakdown === "channel" && data?.breakdown === "channel" ? (data as ChannelUsageResp) : null;

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
          {MODES.map((m) => (
            <button
              key={m.key}
              className={`px-3 py-1 cursor-pointer transition-colors ${
                mode === m.key ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => setMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        {mode === "custom" && (
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <input
              type="date"
              value={customFrom}
              max={customTo}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 bg-white"
            />
            <span className="text-gray-400">至</span>
            <input
              type="date"
              value={customTo}
              min={customFrom}
              onChange={(e) => setCustomTo(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 bg-white"
            />
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {(["day", "month", "year"] as const).map((g) => (
                <button
                  key={g}
                  className={`px-2 py-1 cursor-pointer ${
                    customGran === g ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                  onClick={() => setCustomGran(g)}
                >
                  {g === "day" ? "日" : g === "month" ? "月" : "年"}
                </button>
              ))}
            </div>
          </div>
        )}
        <span className="text-xs text-gray-400 ml-auto">
          {data ? `${data.from ?? "最早"} ~ ${data.to ?? "今"} · ${data.rows.length} 行` : "加载中"}
          {error && " · 刷新失败，保留上次数据"}
        </span>
      </div>

      {chData ? (
        <ChannelTable data={chData} dateColTitle={dateColTitle} />
      ) : (
        <FlatTable data={data && data.breakdown === "none" ? data : null} dateColTitle={dateColTitle} />
      )}
      <div className="text-xs text-gray-400 mt-2">
        按本地时区（服务器 TZ）分桶；每 {POLL_INTERVAL / 1000} 秒自动刷新
        {model ? " · 已筛选当前模型" : ""}
        {breakdown === "channel" ? " · 明细行按渠道拆分" : ""}
      </div>
    </div>
  );
}

/** 平铺表（仪表盘用） */
function FlatTable({ data, dateColTitle }: { data: UsageResp | null; dateColTitle: string }) {
  const rows = data?.rows ?? [];
  const t = data?.total;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
            <th className="py-2 pr-4 font-medium">{dateColTitle}</th>
            <th className="py-2 pr-4 font-medium text-right">调用次数</th>
            <th className="py-2 pr-4 font-medium text-right">成功率</th>
            <th className="py-2 pr-4 font-medium text-right">输入 Tokens</th>
            <th className="py-2 pr-4 font-medium text-right">输出 Tokens</th>
            <th className="py-2 pr-4 font-medium text-right">总 Tokens</th>
            <th className="py-2 font-medium text-right">消费</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="py-8 text-center text-gray-400">
                所选区间暂无数据
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.date} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="py-2 pr-4 font-mono">{row.date}</td>
              <td className="py-2 pr-4 text-right font-mono">{fmt(row.count)}</td>
              <td className="py-2 pr-4 text-right font-mono">{row.count > 0 ? `${((row.success / row.count) * 100).toFixed(1)}%` : "-"}</td>
              <td className="py-2 pr-4 text-right font-mono text-indigo-600">{fmt(row.promptTokens)}</td>
              <td className="py-2 pr-4 text-right font-mono text-violet-600">{fmt(row.completionTokens)}</td>
              <td className="py-2 pr-4 text-right font-mono font-medium">{fmt(row.promptTokens + row.completionTokens)}</td>
              <td className="py-2 text-right font-mono">{usd(row.cost)}</td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className="py-2 pr-4">合计</td>
              <td className="py-2 pr-4 text-right font-mono">{fmt(t?.count ?? 0)}</td>
              <td className="py-2 pr-4 text-right font-mono">{t && t.count > 0 ? `${((t.success / t.count) * 100).toFixed(1)}%` : "-"}</td>
              <td className="py-2 pr-4 text-right font-mono text-indigo-600">{fmt(t?.promptTokens ?? 0)}</td>
              <td className="py-2 pr-4 text-right font-mono text-violet-600">{fmt(t?.completionTokens ?? 0)}</td>
              <td className="py-2 pr-4 text-right font-mono">{fmt((t?.promptTokens ?? 0) + (t?.completionTokens ?? 0))}</td>
              <td className="py-2 text-right font-mono">{usd(t?.cost ?? 0)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** 渠道明细分组表（模型详情页用，new-api 风格：日期 rowspan + 渠道子行 + 细分） */
function ChannelTable({ data, dateColTitle }: { data: ChannelUsageResp; dateColTitle: string }) {
  const rows = data.rows;
  const t = data.total;

  // 按日期分组（行序已是日期倒序）；组内行数用于 rowspan
  const groups = new Map<string, ChannelUsageRow[]>();
  for (const row of rows) {
    const list = groups.get(row.date) ?? [];
    list.push(row);
    groups.set(row.date, list);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
            <th className="py-2 pr-3 font-medium">{dateColTitle}</th>
            <th className="py-2 pr-3 font-medium">渠道</th>
            <th className="py-2 pr-3 font-medium text-right">调用次数</th>
            <th className="py-2 pr-3 font-medium text-right">成功率</th>
            <th className="py-2 pr-3 font-medium text-right">输入</th>
            <th className="py-2 pr-3 font-medium text-right text-sky-600" title="输入中命中上游缓存的部分">缓存命中</th>
            <th className="py-2 pr-3 font-medium text-right text-orange-500" title="= 输入 - 缓存命中">缓存未命中</th>
            <th className="py-2 pr-3 font-medium text-right">输出</th>
            <th className="py-2 pr-3 font-medium text-right" title="reasoning + thinking">推理</th>
            <th className="py-2 pr-3 font-medium text-right" title="= 输出 - 推理">回答</th>
            <th className="py-2 pr-3 font-medium text-right">token</th>
            <th className="py-2 font-medium text-right">消费</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={12} className="py-8 text-center text-gray-400">
                所选区间暂无数据
              </td>
            </tr>
          )}
          {[...groups.entries()].map(([date, groupRows]) => (
            <Fragment key={date}>
              {groupRows.map((row, i) => {
                return (
                  <tr key={`${date}-${row.channel ?? "unknown"}`} className="border-b border-gray-100 hover:bg-gray-50">
                    {i === 0 ? (
                      <td rowSpan={groupRows.length} className="py-2 pr-3 font-mono align-top whitespace-nowrap border-r border-gray-100">
                        {date}
                      </td>
                    ) : null}
                    <td className="py-2 pr-3 max-w-[220px] truncate" title={row.channel ?? ""}>{row.channel ?? "未知"}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmt(row.count)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{row.count > 0 ? `${((row.success / row.count) * 100).toFixed(1)}%` : "-"}</td>
                    <td className="py-2 pr-3 text-right font-mono text-indigo-600">{fmt(row.promptTokens)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-sky-600">{fmt(row.cachedTokens)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-orange-500">{fmt(Math.max(0, row.promptTokens - row.cachedTokens))}</td>
                    <td className="py-2 pr-3 text-right font-mono text-violet-600">{fmt(row.completionTokens)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-fuchsia-600">{fmt(row.reasoningTokens)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmt(Math.max(0, row.completionTokens - row.reasoningTokens))}</td>
                    <td className="py-2 pr-3 text-right font-mono font-medium">{fmt(row.promptTokens + row.completionTokens)}</td>
                    <td className="py-2 text-right font-mono">{usd(row.cost)}</td>
                  </tr>
                );
              })}
              <tr key={`${date}-sum`} className="bg-gray-50/70 border-b border-gray-200 text-xs">
                <td colSpan={2} className="py-1.5 pr-3 text-gray-500">{date} 小计</td>
                <td className="py-1.5 pr-3 text-right font-mono">{fmt(groupRows.reduce((s, r) => s + r.count, 0))}</td>
                <td className="py-1.5 pr-3 text-right font-mono">-</td>
                <td className="py-1.5 pr-3 text-right font-mono">{fmt(groupRows.reduce((s, r) => s + r.promptTokens, 0))}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{fmt(groupRows.reduce((s, r) => s + r.cachedTokens, 0))}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{fmt(groupRows.reduce((s, r) => s + Math.max(0, r.promptTokens - r.cachedTokens), 0))}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{fmt(groupRows.reduce((s, r) => s + r.completionTokens, 0))}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{fmt(groupRows.reduce((s, r) => s + r.reasoningTokens, 0))}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{fmt(groupRows.reduce((s, r) => s + Math.max(0, r.completionTokens - r.reasoningTokens), 0))}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{fmt(groupRows.reduce((s, r) => s + r.promptTokens + r.completionTokens, 0))}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{usd(groupRows.reduce((s, r) => s + r.cost, 0))}</td>
              </tr>
            </Fragment>
          ))}
          {rows.length > 0 && (
            <tr className="border-t-2 border-gray-300 bg-gray-100 font-semibold">
              <td colSpan={2} className="py-2 pr-3">合计</td>
              <td className="py-2 pr-3 text-right font-mono">{fmt(t.count)}</td>
              <td className="py-2 pr-3 text-right font-mono">{t.count > 0 ? `${((t.success / t.count) * 100).toFixed(1)}%` : "-"}</td>
              <td className="py-2 pr-3 text-right font-mono text-indigo-600">{fmt(t.promptTokens)}</td>
              <td className="py-2 pr-3 text-right font-mono text-sky-600">{fmt(t.cachedTokens)}</td>
              <td className="py-2 pr-3 text-right font-mono text-orange-500">{fmt(Math.max(0, t.promptTokens - t.cachedTokens))}</td>
              <td className="py-2 pr-3 text-right font-mono text-violet-600">{fmt(t.completionTokens)}</td>
              <td className="py-2 pr-3 text-right font-mono text-fuchsia-600">{fmt(t.reasoningTokens)}</td>
              <td className="py-2 pr-3 text-right font-mono">{fmt(Math.max(0, t.completionTokens - t.reasoningTokens))}</td>
              <td className="py-2 pr-3 text-right font-mono">{fmt(t.promptTokens + t.completionTokens)}</td>
              <td className="py-2 pr-3 text-right font-mono">{usd(t.cost)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
