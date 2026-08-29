"use client";

import { useMemo, useState } from "react";
import { VChart } from "@visactor/react-vchart";

export interface DailyPoint {
  date: string;
  label: string;
  total: number;
  success: number;
  cost: number;
  promptTokens: number;
  completionTokens: number;
  perModel: Record<string, { count: number; cost: number; tokens: number }>;
}

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

export default function TrendChart({ daily, hourly }: { daily: DailyPoint[]; hourly: DailyPoint[] }) {
  const [view, setView] = useState<"day" | "hour">("day");
  const [metric, setMetric] = useState<Metric>("count");
  const [tab, setTab] = useState<Tab>("trend");

  const data = view === "day" ? daily : hourly;
  const yField = METRICS.find((m) => m.key === metric)!.yField;

  // 展开为长表：每个时间桶 × 每个模型一行
  const longData = useMemo(() => {
    const rows: Array<{ Time: string; Model: string; 次数: number; Tokens: number; "消费($)": number }> = [];
    for (const b of data) {
      for (const [model, v] of Object.entries(b.perModel)) {
        rows.push({
          Time: b.label,
          Model: model,
          次数: v.count,
          Tokens: v.tokens,
          "消费($)": v.cost / 100000,
        });
      }
    }
    return rows;
  }, [data]);

  // 模型聚合（饼图/排名用）
  const modelTotals = useMemo(() => {
    const map = new Map<string, { count: number; cost: number; tokens: number }>();
    for (const b of data) {
      for (const [model, v] of Object.entries(b.perModel)) {
        const cur = map.get(model) ?? { count: 0, cost: 0, tokens: 0 };
        cur.count += v.count;
        cur.cost += v.cost;
        cur.tokens += v.tokens;
        map.set(model, cur);
      }
    }
    return [...map.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.count - a.count);
  }, [data]);

  const metricLabel = METRICS.find((m) => m.key === metric)!.label;
  const rangeText = view === "day" ? "近 14 天" : "近 24 小时";

  // 趋势：按模型堆叠面积图（new-api 同款 spec 结构）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trendSpec: any = useMemo(
    () => ({
      type: "area" as const,
      data: [{ id: "lineData", values: longData }],
      xField: "Time",
      yField,
      seriesField: "Model",
      stack: true,
      area: { style: { fillOpacity: 0.35, curveType: "monotone" } },
      line: { style: { curveType: "monotone", lineWidth: 2 } },
      legends: { visible: true, selectMode: "multiple" as const, position: "top" as const },
      tooltip: {
        mark: {
          title: { value: (d: { Time?: string }) => `${d.Time}（${rangeText}）` },
          content: [
            {
              key: (d: Record<string, unknown>) => d.Model as string,
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

  // 占比：模型调用次数饼图
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pieSpec: any = useMemo(
    () => ({
      type: "pie" as const,
      data: [{ id: "pieData", values: modelTotals.map((m) => ({ type: m.type, value: m.count })) }],
      outerRadius: 0.8,
      innerRadius: 0.55,
      padAngle: 0.6,
      valueField: "value",
      categoryField: "type",
      label: { visible: true },
      legends: { visible: true, position: "right" as const, selectMode: "multiple" as const },
      tooltip: { mark: { content: [{ key: (d: Record<string, unknown>) => d.type as string, value: (d: Record<string, unknown>) => `${fmt(Number(d.value))} 次` }] } },
      title: { visible: true, text: "调用次数分布", subtext: modelTotals.length === 0 ? "暂无数据" : undefined },
      height: 300,
    }),
    [modelTotals],
  );

  // 排名：Top 10 模型条形图
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rankSpec: any = useMemo(() => {
    const values = modelTotals.slice(0, 10).map((m) => ({ Model: m.type, 次数: m.count }));
    return {
      type: "bar" as const,
      data: [{ id: "rankData", values }],
      xField: "Model",
      yField: "次数",
      seriesField: "Model",
      legends: { visible: false },
      tooltip: { mark: { content: [{ key: (d: Record<string, unknown>) => d.Model as string, value: (d: Record<string, unknown>) => `${fmt(Number(d["次数"]))} 次` }] } },
      title: { visible: true, text: "模型调用排名 Top 10", subtext: values.length === 0 ? "暂无数据" : undefined },
      height: 300,
    };
  }, [modelTotals]);

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
        {/* 图表类型标签页（new-api 同款：趋势/占比/排名） */}
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
            {metricLabel} · {rangeText} · 按模型堆叠；点击图例可隐藏/显示对应模型
            {tab === "trend" && metric === "cost" ? "（消费单位：美元）" : ""}
          </>
        )}
        {tab === "pie" && `${rangeText}各模型调用次数占比`}
        {tab === "rank" && `${rangeText}模型调用次数排名`}
      </div>
    </div>
  );
}
