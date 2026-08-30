"use client";

import { useMemo, useState } from "react";
import { VChart } from "@visactor/react-vchart";

export interface TrendPoint {
  date: string;
  label: string;
  total: number;
  success: number;
  cost: number;
  promptTokens: number;
  completionTokens: number;
  perSeries: Record<string, { count: number; cost: number; tokens: number }>;
}

/** 兼容旧字段名（仪表盘仍传 perModel 形状的数据） */
export type DailyPoint = TrendPoint;

type Metric = "count" | "tokens" | "cost";
type Tab = "trend" | "pie" | "rank";

const METRICS: Array<{ key: Metric; label: string; yField: string }> = [
  { key: "count", label: "调用次数", yField: "次数" },
  { key: "tokens", label: "Tokens", yField: "Tokens" },
  { key: "cost", label: "消费金额", yField: "消费($)" },
];

function fmt(n: number): string {
  return n.toLocaleString("zh-CN");
}

export default function TrendChart({
  daily,
  hourly,
  minutely,
  seriesName = "模型",
}: {
  daily: TrendPoint[];
  hourly: TrendPoint[];
  minutely: TrendPoint[];
  /** 序列维度名称：仪表盘=模型，模型详情页=渠道 */
  seriesName?: string;
}) {
  const [view, setView] = useState<"day" | "hour" | "minute">("day");
  const [metric, setMetric] = useState<Metric>("count");
  const [tab, setTab] = useState<Tab>("trend");

  const data = view === "day" ? daily : view === "hour" ? hourly : minutely;
  const yField = METRICS.find((m) => m.key === metric)!.yField;

  // 展开为长表：每个时间桶 × 每个序列一行
  const longData = useMemo(() => {
    const rows: Array<{ Time: string; Series: string; 次数: number; Tokens: number; "消费($)": number }> = [];
    for (const b of data) {
      for (const [name, v] of Object.entries(b.perSeries)) {
        rows.push({
          Time: b.label,
          Series: name,
          次数: v.count,
          Tokens: v.tokens,
          "消费($)": v.cost / 100000,
        });
      }
    }
    return rows;
  }, [data]);

  // 序列聚合（饼图/排名用）
  const seriesTotals = useMemo(() => {
    const map = new Map<string, { count: number; cost: number; tokens: number }>();
    for (const b of data) {
      for (const [name, v] of Object.entries(b.perSeries)) {
        const cur = map.get(name) ?? { count: 0, cost: 0, tokens: 0 };
        cur.count += v.count;
        cur.cost += v.cost;
        cur.tokens += v.tokens;
        map.set(name, cur);
      }
    }
    return [...map.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.count - a.count);
  }, [data]);

  const metricLabel = METRICS.find((m) => m.key === metric)!.label;
  const rangeText = view === "day" ? "近 14 天" : view === "hour" ? "近 24 小时" : "近 60 分钟";

  // 趋势：按序列堆叠面积图；y 轴与 tooltip 都做千分位
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trendSpec: any = useMemo(
    () => ({
      type: "area" as const,
      data: [{ id: "lineData", values: longData }],
      xField: "Time",
      yField,
      seriesField: "Series",
      stack: true,
      area: { style: { fillOpacity: 0.35, curveType: "monotone" } },
      line: { style: { curveType: "monotone", lineWidth: 2 } },
      axes: [
        // 千分位：y 轴数值每三位加逗号；VChart formatMethod 入参可能是 number 或 string
        { orient: "left", formatMethod: (n: number | string) => fmt(Number(n)) },
      ],
      legends: { visible: true, selectMode: "multiple" as const, position: "top" as const },
      tooltip: {
        mark: {
          title: { value: (d: { Time?: string }) => `${d.Time}（${rangeText}）` },
          content: [
            {
              key: (d: Record<string, unknown>) => d.Series as string,
              value: (d: Record<string, unknown>) => fmt(Number(d[yField]) || 0),
            },
            {
              key: "合计",
              value: (d: Record<string, unknown>) => {
                const same = (longData as Array<Record<string, unknown>>).filter((r) => r.Time === d.Time);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return fmt(same.reduce((s, r) => s + Number((r as any)[yField]) || 0, 0));
              },
            },
          ],
        },
      },
      height: 300,
    }),
    [longData, yField, rangeText],
  );

  // 占比：调用次数饼图
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pieSpec: any = useMemo(
    () => ({
      type: "pie" as const,
      data: [{ id: "pieData", values: seriesTotals.map((s) => ({ type: s.type, value: s.count })) }],
      outerRadius: 0.8,
      innerRadius: 0.55,
      padAngle: 0.6,
      valueField: "value",
      categoryField: "type",
      label: { visible: true },
      legends: { visible: true, position: "right" as const, selectMode: "multiple" as const },
      tooltip: { mark: { content: [{ key: (d: Record<string, unknown>) => d.type as string, value: (d: Record<string, unknown>) => `${fmt(Number(d.value))} 次` }] } },
      title: { visible: true, text: `${seriesName}调用次数分布`, subtext: seriesTotals.length === 0 ? "暂无数据" : undefined },
      height: 300,
    }),
    [seriesTotals, seriesName],
  );

  // 排名：Top 10 条形图
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rankSpec: any = useMemo(() => {
    const values = seriesTotals.slice(0, 10).map((s) => ({ Name: s.type, 次数: s.count }));
    return {
      type: "bar" as const,
      data: [{ id: "rankData", values }],
      xField: "Name",
      yField: "次数",
      seriesField: "Name",
      legends: { visible: false },
      axes: [
        { orient: "left", formatMethod: (n: number | string) => fmt(Number(n)) },
      ],
      tooltip: { mark: { content: [{ key: (d: Record<string, unknown>) => d.Name as string, value: (d: Record<string, unknown>) => `${fmt(Number(d["次数"]))} 次` }] } },
      title: { visible: true, text: `${seriesName}调用次数排名 Top 10`, subtext: values.length === 0 ? "暂无数据" : undefined },
      height: 300,
    };
  }, [seriesTotals, seriesName]);

  const spec = tab === "trend" ? trendSpec : tab === "pie" ? pieSpec : rankSpec;

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 粒度切换 */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            <button
              className={`px-3 py-1 cursor-pointer transition-colors ${
                view === "day" ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => setView("day")}
            >
              按天
            </button>
            <button
              className={`px-3 py-1 cursor-pointer transition-colors ${
                view === "hour" ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => setView("hour")}
            >
              按小时
            </button>
            <button
              className={`px-3 py-1 cursor-pointer transition-colors ${
                view === "minute" ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => setView("minute")}
            >
              按分钟
            </button>
          </div>
          {/* 指标切换（仅趋势图需要） */}
          {tab === "trend" && (
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              {METRICS.map((m) => (
                <button
                  key={m.key}
                  className={`px-3 py-1 cursor-pointer transition-colors ${
                    metric === m.key ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white" : "bg-white text-gray-600 hover:bg-indigo-50"
                  }`}
                  onClick={() => setMetric(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* 图表类型标签页 */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
          {(
            [
              { key: "trend", label: "趋势" },
              { key: "pie", label: "占比" },
              { key: "rank", label: "排名" },
            ] as Array<{ key: Tab; label: string }>
          ).map((tb) => (
            <button
              key={tb.key}
              className={`px-3 py-1 cursor-pointer transition-colors ${
                tab === tb.key ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => setTab(tb.key)}
            >
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ height: 300 }}>
        <VChart spec={spec} />
      </div>
      <div className="text-xs text-gray-400 mt-2">
        {tab === "trend" && (
          <>
            {metricLabel} · {rangeText} · 按{seriesName}堆叠；点击图例可隐藏/显示对应{seriesName}
            {tab === "trend" && metric === "cost" ? "（消费单位：美元）" : ""}
          </>
        )}
        {tab === "pie" && `${rangeText}各${seriesName}调用次数占比`}
        {tab === "rank" && `${rangeText}${seriesName}调用次数排名`}
      </div>
    </div>
  );
}
