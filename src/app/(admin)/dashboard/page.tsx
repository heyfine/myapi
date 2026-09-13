"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, usd } from "@/lib/client-utils";
import TrendChart, { type DailyPoint } from "@/components/TrendChart";
import UsageTable from "@/components/UsageTable";

type Stats = {
  range?: string;
  overall: {
    total: number;
    success: number;
    cost: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
    thinkingTokens: number;
    detailMissing: number;
    estimatedCount: number;
  };
  today: { total: number; cost: number };
  byModel: Array<{ model: string | null; total: number; cost: number; promptTokens: number; completionTokens: number; cachedTokens: number; reasoningTokens: number; thinkingTokens: number }>;
  daily: DailyPoint[];
  hourly: DailyPoint[];
  minutely: DailyPoint[];
  trend: DailyPoint[];
  trendGranularity: "hour" | "day" | "month";
  trendLabel: string;
  allModels: string[];
};

type RangeKey = "day" | "week" | "month" | "custom" | "all";

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string; title: string }> = [
  { key: "day", label: "按天", title: "查看任意一天（点击弹出日期选择，按小时桶）" },
  { key: "week", label: "近7天", title: "近 7 个自然日（含今天）" },
  { key: "month", label: "按月", title: "查看任意自然月（点击弹出月份选择，按天桶）" },
  { key: "custom", label: "自定义", title: "自选起止日期（依次弹起始/结束日期选择）" },
  { key: "all", label: "全部", title: "不限时间" },
];

/** 指标卡标签前缀：累计类卡片跟随所选范围（按天/按月显示所选日期/月份） */
function cardPrefix(range: RangeKey, dayDate: string, monthVal: string): string {
  const now = new Date();
  if (range === "all") return "";
  if (range === "week") return "近 7 天";
  if (range === "custom") return "所选范围";
  if (range === "day") return dayDate === ymd(now) ? "今日" : dayDate.slice(5).replace("-", "/");
  return monthVal === ymd(now).slice(0, 7) ? "本月" : monthVal;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmt(n: number): string {
  return n.toLocaleString("zh-CN");
}

/** 轮询间隔：人眼看不出 5s 差距，再短就会让 VChart 反复重绘 */
const POLL_INTERVAL = 5000;

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [range, setRange] = useState<RangeKey>("all");
  /** 自定义起止日期：初始化预填最近 30 天（隐藏锚定输入需要带值，原生面板才能显示当前选择） */
  const [customFrom, setCustomFrom] = useState(() => ymd(new Date(Date.now() - 29 * 86400000)));
  const [customTo, setCustomTo] = useState(() => ymd(new Date()));
  /** 「按天」选中的日期（YYYY-MM-DD，默认今天）与「按月」选中的月份（YYYY-MM，默认本月） */
  const [dayDate, setDayDate] = useState(() => ymd(new Date()));
  const [monthVal, setMonthVal] = useState(() => ymd(new Date()).slice(0, 7));
  /**
   * 零尺寸隐藏输入，锚定在按钮组正下方：点范围按钮时同步 showPicker() 直接弹原生日期面板
   * （面板就出现在按钮下方，无需额外的浮层框）。
   */
  const dayPickerRef = useRef<HTMLInputElement>(null);
  const monthPickerRef = useRef<HTMLInputElement>(null);
  const fromPickerRef = useRef<HTMLInputElement>(null);
  const toPickerRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);

  function showPicker(ref: React.RefObject<HTMLInputElement | null>): void {
    try {
      ref.current?.showPicker();
    } catch {
      /* 非用户手势或浏览器不支持时静默（按钮点击路径均有激活，正常不会走到） */
    }
  }

  /** 点范围按钮：激活范围并直接弹出对应的原生日期面板 */
  function chooseRange(key: RangeKey): void {
    setRange(key);
    if (key === "day") showPicker(dayPickerRef);
    else if (key === "month") showPicker(monthPickerRef);
    else if (key === "custom") {
      // 首次点自定义弹起始日期（选完 from 的 onChange 自动接弹 to）；已激活时再点直接弹结束日期，方便只调 to
      showPicker(range === "custom" ? toPickerRef : fromPickerRef);
    }
  }

  // 5s 轮询：不可见时跳过（后台标签不白烧）；请求序号保证只有最新一次响应能落状态（防慢响应把数字改回去）
  useEffect(() => {
    let alive = true;

    function load(): void {
      if (document.visibilityState !== "visible") return;
      const seq = ++seqRef.current;
      let q = `?range=${range}`;
      if (range === "custom" && customFrom && customTo) q = `?range=custom&from=${customFrom}&to=${customTo}`;
      else if (range === "day" && dayDate) q = `?range=day&date=${dayDate}`;
      else if (range === "month" && monthVal) q = `?range=month&month=${monthVal}`;
      api<Stats>(`/api/stats${q}`)
        .then((data) => {
          if (!alive || seq !== seqRef.current) return;
          setStats(data);
          setUpdatedAt(new Date());
          setError("");
        })
        .catch((e: Error) => {
          if (!alive || seq !== seqRef.current) return;
          setError(e.message);
        });
    }

    load();
    const timer = setInterval(load, POLL_INTERVAL);
    function onVisibilityChange(): void {
      if (document.visibilityState === "visible") load();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [range, customFrom, customTo, dayDate, monthVal]);

  const filteredModels = (stats?.allModels ?? []).filter((m) =>
    m.toLowerCase().includes(modelFilter.toLowerCase()),
  );
  const calls24h = new Map<string, number>();
  for (const m of stats?.byModel ?? []) if (m.model) calls24h.set(m.model, m.total);

  const daily = stats?.daily ?? [];

  // 累计类卡片跟随全局范围；「近 24h」两卡与模型列表、用量表、Top10 固定不受影响
  const prefix = cardPrefix(range, dayDate, monthVal);
  const cards = stats
    ? [
        { label: `${prefix || "总"}调用次数`, value: String(stats.overall.total), accent: "#6366f1", text: "text-indigo-600" },
        {
          label: "成功率",
          value: stats.overall.total > 0 ? `${((stats.overall.success / stats.overall.total) * 100).toFixed(1)}%` : "-",
          accent: "#10b981",
          text: "text-emerald-600",
        },
        { label: `${prefix || "累计"}消费`, value: `$${usd(stats.overall.cost)}`, accent: "#8b5cf6", text: "text-violet-600" },
        { label: "近 24h 调用", value: String(stats.today.total), accent: "#0ea5e9", text: "text-sky-600" },
        { label: "近 24h 消费", value: `$${usd(stats.today.cost)}`, accent: "#f97316", text: "text-orange-600" },
        {
          label: `${prefix || "总"} Tokens`,
          value: `${fmt(stats.overall.promptTokens + stats.overall.completionTokens)}`,
          accent: "#f43f5e",
          text: "text-rose-600",
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold">仪表盘</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 全局时间范围：控制顶部累计指标卡与趋势图（模型列表/近24h卡/用量表不受影响） */}
          <div className="relative">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              {RANGE_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  title={o.title}
                  className={`px-3 py-1 cursor-pointer transition-colors ${
                    range === o.key ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                  onClick={() => chooseRange(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {/* 零尺寸锚定输入：showPicker 的原生面板会贴在按钮组正下方弹出，无需可见框 */}
            <input
              ref={dayPickerRef}
              type="date"
              aria-label="选择查看日期"
              className="pointer-events-none absolute left-0 top-full h-0 w-0 border-0 opacity-0"
              value={dayDate}
              max={ymd(new Date())}
              onChange={(e) => e.target.value && setDayDate(e.target.value)}
            />
            <input
              ref={monthPickerRef}
              type="month"
              aria-label="选择查看月份"
              className="pointer-events-none absolute left-0 top-full h-0 w-0 border-0 opacity-0"
              value={monthVal}
              max={ymd(new Date()).slice(0, 7)}
              onChange={(e) => e.target.value && setMonthVal(e.target.value)}
            />
            <input
              ref={fromPickerRef}
              type="date"
              aria-label="自定义起始日期"
              className="pointer-events-none absolute left-0 top-full h-0 w-0 border-0 opacity-0"
              value={customFrom}
              max={customTo}
              onChange={(e) => {
                if (!e.target.value) return;
                setCustomFrom(e.target.value);
                showPicker(toPickerRef); // 选完起始日接着选结束日
              }}
            />
            <input
              ref={toPickerRef}
              type="date"
              aria-label="自定义结束日期"
              className="pointer-events-none absolute left-0 top-full h-0 w-0 border-0 opacity-0"
              value={customTo}
              min={customFrom}
              onChange={(e) => e.target.value && setCustomTo(e.target.value)}
            />
          </div>
          <div className="text-xs text-gray-400">
            {error && stats
              ? "刷新失败，保留上次数据"
              : `每 ${POLL_INTERVAL / 1000} 秒自动刷新${updatedAt ? ` · 更新于 ${updatedAt.toLocaleTimeString("zh-CN", { hour12: false })}` : ""}`}
          </div>
        </div>
      </div>
      {error && !stats && <div className="text-red-600 text-sm">{error}</div>}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="card border-l-4" style={{ borderLeftColor: c.accent }}>
            <div className="text-xs text-gray-500">{c.label}</div>
            <div className={`text-lg font-semibold mt-1 truncate font-mono ${c.text}`} title={c.value}>
              {c.value}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="font-semibold mb-3">Token 用量统计（{prefix || "累计"}）</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 输入：含缓存命中/未命中细分 */}
          <div className="rounded-xl border border-dashed border-indigo-200 bg-gradient-to-br from-indigo-50/70 to-white px-4 py-4 text-center">
            <div className="text-sm text-indigo-500/90" title="发给上游的全部输入（含缓存部分）">输入</div>
            <div className="text-2xl font-semibold font-mono mt-1 text-indigo-600">{fmt(stats?.overall.promptTokens ?? 0)}</div>
            <div className="flex justify-center gap-6 mt-3 text-xs text-gray-600 flex-wrap">
              <span title="输入中命中上游缓存的部分">缓存命中 <span className="font-mono font-medium text-emerald-600">{fmt(stats?.overall.cachedTokens ?? 0)}</span></span>
              <span title="输入中未命中缓存的部分（= 输入 - 缓存命中），按正常输入价计费">缓存未命中 <span className="font-mono font-medium text-orange-500">{fmt(Math.max(0, (stats?.overall.promptTokens ?? 0) - (stats?.overall.cachedTokens ?? 0)))}</span></span>
            </div>
          </div>
          {/* 输出：含推理/回答细分 */}
          <div className="rounded-xl border border-dashed border-violet-200 bg-gradient-to-br from-violet-50/70 to-white px-4 py-4 text-center">
            <div className="text-sm text-violet-500/90" title="上游生成的全部输出">输出</div>
            <div className="text-2xl font-semibold font-mono mt-1 text-violet-600">{fmt(stats?.overall.completionTokens ?? 0)}</div>
            <div className="flex justify-center gap-6 mt-3 text-xs text-gray-600 flex-wrap">
              <span title="模型的思考过程（reasoning / thoughts tokens 合计）">推理 <span className="font-mono font-medium text-fuchsia-600">{fmt((stats?.overall.reasoningTokens ?? 0) + (stats?.overall.thinkingTokens ?? 0))}</span></span>
              <span title="最终回答文本（= 输出 - 推理）">回答 <span className="font-mono font-medium text-sky-600">{fmt(Math.max(0, (stats?.overall.completionTokens ?? 0) - (stats?.overall.reasoningTokens ?? 0) - (stats?.overall.thinkingTokens ?? 0)))}</span></span>
            </div>
          </div>
          {/* 总 Tokens */}
          <div className="rounded-xl border border-dashed border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-white px-4 py-4 text-center">
            <div className="text-sm text-emerald-500/90">总 Tokens</div>
            <div className="text-2xl font-semibold font-mono mt-1 text-emerald-600">{fmt((stats?.overall.promptTokens ?? 0) + (stats?.overall.completionTokens ?? 0))}</div>
            <div className="mt-3 text-xs text-gray-400">= 输入 + 输出</div>
          </div>
        </div>
        <div className="text-xs text-gray-400 mt-3">
          缓存命中包含在输入内，推理包含在输出内；细分数字取决于上游是否返回对应明细字段，未返回时为 0
          {(stats?.overall.detailMissing ?? 0) > 0 && (
            <span className="text-amber-600 font-medium">
              ⚠ 有 {fmt(stats!.overall.detailMissing)} 次调用的上游未返回缓存/推理明细，相关细分按 0 统计
            </span>
          )}
          {(stats?.overall.estimatedCount ?? 0) > 0 && (
            <span className="text-amber-600 font-medium">
              {"　"}⚠ 有 {fmt(stats!.overall.estimatedCount)} 次调用上游未返回 usage，token 数为估算值
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <div className="font-semibold mb-3">趋势（按范围 / 按天 / 按小时 / 按分钟）</div>
        {daily.length > 0 || (stats?.trend.length ?? 0) > 0 || (stats?.hourly.length ?? 0) > 0 || (stats?.minutely.length ?? 0) > 0 ? (
          <TrendChart
            daily={daily}
            hourly={stats?.hourly ?? []}
            minutely={stats?.minutely ?? []}
            rangeTrend={stats?.trend ?? []}
            rangeLabel={stats?.trendLabel}
          />
        ) : (
          <div className="text-sm text-gray-400 py-8 text-center">暂无数据</div>
        )}
      </div>

      {/* Token 用量统计（按日期维度，全量汇总，含缓存/推理细分列） */}
      <div className="card">
        <div className="font-semibold mb-3">Token 用量统计（按天 / 按月 / 按年 / 自定义）</div>
        <UsageTable />
      </div>

      {/* 模型列表 */}
      <div className="card">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="font-semibold">
            模型列表 <span className="text-xs text-gray-400 font-normal">共 {filteredModels.length} 个（来自启用的渠道，点击查看详情）</span>
          </div>
          <input
            className="input !w-64 !py-1.5 text-xs"
            placeholder="搜索模型名..."
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
          />
        </div>
        {filteredModels.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {filteredModels.map((m) => {
              const calls = calls24h.get(m);
              return (
                <Link
                  key={m}
                  href={`/model-detail?model=${encodeURIComponent(m)}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
                  title={`查看 ${m} 详情`}
                >
                  <span className="font-mono text-xs truncate">{m}</span>
                  {calls !== undefined && (
                    <span className="badge bg-blue-50 text-blue-600 text-[10px] shrink-0">24h {calls} 次</span>
                  )}
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-gray-400 py-4 text-center">
            {stats && stats.allModels.length === 0 ? "暂无启用的渠道模型，请先到渠道管理添加" : "没有匹配的模型"}
          </div>
        )}
      </div>

      <div className="card">
        <div className="font-semibold mb-3">近 24 小时模型用量 Top 10</div>
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">模型</th>
              <th className="th">调用次数</th>
              <th className="th">输入</th>
              <th className="th">输出</th>
              <th className="th">缓存命中</th>
              <th className="th">推理</th>
              <th className="th">总 Tokens</th>
              <th className="th">消费</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.byModel ?? []).map((m) => (
              <tr key={m.model ?? "-"}>
                <td className="td font-mono text-xs">
                  {m.model ? (
                    <Link href={`/model-detail?model=${encodeURIComponent(m.model)}`} className="text-blue-600 hover:underline" title="查看模型详情">
                      {m.model}
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="td">{m.total}</td>
                <td className="td font-mono text-xs">{fmt(m.promptTokens)}</td>
                <td className="td font-mono text-xs">{fmt(m.completionTokens)}</td>
                <td className="td font-mono text-xs">{fmt(m.cachedTokens)}</td>
                <td className="td font-mono text-xs">{fmt(m.reasoningTokens + m.thinkingTokens)}</td>
                <td className="td font-mono text-xs">{fmt(m.promptTokens + m.completionTokens)}</td>
                <td className="td">${usd(m.cost)}</td>
              </tr>
            ))}
            {stats && stats.byModel.length === 0 && (
              <tr>
                <td className="td text-gray-400" colSpan={7}>
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
