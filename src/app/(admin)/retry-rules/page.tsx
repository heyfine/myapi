"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-utils";

type Rule = {
  id: number;
  errorCode: number;
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  jitter: number;
  enabled: number;
};

const emptyForm = { id: 0, errorCode: 429, maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 10000, jitter: 0.1, enabled: 1 };

function errorCodeLabel(code: number) {
  return code === 0 ? "全局默认" : String(code);
}

const COMMON_HINTS: Record<number, string> = {
  0: "所有未单独设置的错误代号都走这条全局规则；单独设置的代号优先于它",
  408: "请求超时",
  409: "请求冲突",
  429: "限流（Too Many Requests）",
  500: "上游内部错误",
  502: "网关/代理错误",
  503: "服务暂不可用",
  504: "上游超时",
};

export default function RetryRulesPage() {
  const [list, setList] = useState<Rule[]>([]);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<{ data: Rule[] }>("/api/retry-rules")
      .then((d) => setList(d.data))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  /** 关闭浮窗；仅通过 ✕ / ESC / 取消 触发 */
  function closeForm() {
    setForm(null);
  }

  // ESC 关闭浮窗
  useEffect(() => {
    if (!form) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeForm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form !== null]);

  async function save() {
    if (!form) return;
    try {
      if (form.id) {
        await api(`/api/retry-rules/${form.id}`, {
          method: "PUT",
          body: JSON.stringify({ errorCode: form.errorCode, maxRetries: form.maxRetries, initialDelayMs: form.initialDelayMs, maxDelayMs: form.maxDelayMs, jitter: form.jitter, enabled: form.enabled }),
        });
      } else {
        await api("/api/retry-rules", {
          method: "POST",
          body: JSON.stringify({ errorCode: form.errorCode, maxRetries: form.maxRetries, initialDelayMs: form.initialDelayMs, maxDelayMs: form.maxDelayMs, jitter: form.jitter, enabled: form.enabled }),
        });
      }
      setForm(null);
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function toggle(rule: Rule) {
    await api(`/api/retry-rules/${rule.id}`, { method: "PUT", body: JSON.stringify({ enabled: rule.enabled ? 0 : 1 }) });
    load();
  }

  async function remove(rule: Rule) {
    if (!confirm(`确认删除错误代号 ${errorCodeLabel(rule.errorCode)} 的重试规则？`)) return;
    await api(`/api/retry-rules/${rule.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">失败重连规则</h1>
          <p className="text-sm text-gray-500 mt-1">
            上游返回指定错误代号时，网关会在<b>同一渠道</b>上自动重连：首次等待"首次重试等待"毫秒，之后每次翻倍（不超过最大等待时间），并按抖动比例随机浮动；重试耗尽后若错误可切换（429/5xx 等），再切换下一渠道。
            <b>命中规则优先级：单独设置的错误代号 &gt; 全局默认</b>；停用全局默认后，未单独设置的代号不做同渠道重试。
          </p>
        </div>
        <button className="btn-primary" onClick={() => setForm({ ...emptyForm })}>
          + 新建规则
        </button>
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr>
              <th className="th">错误代号</th>
              <th className="th">说明</th>
              <th className="th">重试次数</th>
              <th className="th">首次等待</th>
              <th className="th">最大等待</th>
              <th className="th">抖动比例</th>
              <th className="th">状态</th>
              <th className="th">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((rule) => (
              <tr key={rule.id}>
                <td className="td">
                  <span className={`badge font-mono ${rule.errorCode === 0 ? "bg-indigo-100 text-indigo-700" : "bg-blue-50 text-blue-700"}`}>
                    {errorCodeLabel(rule.errorCode)}
                  </span>
                </td>
                <td className="td text-xs text-gray-500">{COMMON_HINTS[rule.errorCode] ?? "-"}</td>
                <td className="td">{rule.maxRetries} 次</td>
                <td className="td font-mono text-xs">{rule.initialDelayMs} ms</td>
                <td className="td font-mono text-xs">{rule.maxDelayMs} ms</td>
                <td className="td font-mono text-xs">{(rule.jitter * 100).toFixed(0)}%</td>
                <td className="td">
                  <span className={`badge ${rule.enabled ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}`}>
                    {rule.enabled ? "启用" : "停用"}
                  </span>
                </td>
                <td className="td space-x-2 whitespace-nowrap">
                  <button
                    className="text-blue-600 text-sm hover:underline cursor-pointer"
                    onClick={() => setForm({ id: rule.id, errorCode: rule.errorCode, maxRetries: rule.maxRetries, initialDelayMs: rule.initialDelayMs, maxDelayMs: rule.maxDelayMs, jitter: rule.jitter, enabled: rule.enabled })}
                  >
                    编辑
                  </button>
                  <button className="text-gray-500 text-sm hover:underline cursor-pointer" onClick={() => toggle(rule)}>
                    {rule.enabled ? "停用" : "启用"}
                  </button>
                  {rule.errorCode !== 0 && (
                    <button className="text-red-500 text-sm hover:underline cursor-pointer" onClick={() => remove(rule)}>
                      删除
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td className="td text-gray-400" colSpan={8}>
                  还没有规则，命中错误的调用将直接切换渠道，不做同渠道重试
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-bold text-lg">{form.id ? "编辑规则" : "新建规则"}</div>
              <button
                type="button"
                className="text-gray-400 hover:text-gray-600 text-xl leading-none cursor-pointer"
                title="关闭 (Esc)"
                onClick={closeForm}
              >
                ✕
              </button>
            </div>
            <div>
              <label className="label">错误代号（上游 HTTP 状态码，全局默认规则请在列表中编辑）</label>
              <input
                className="input font-mono"
                type="number"
                min={1}
                max={599}
                value={form.errorCode}
                onChange={(e) => setForm({ ...form, errorCode: Number(e.target.value) })}
              />
              {COMMON_HINTS[form.errorCode] && <div className="text-xs text-gray-400 mt-1">{COMMON_HINTS[form.errorCode]}</div>}
            </div>
            <div>
              <label className="label">重试次数（0-20，0 表示命中后不重试）</label>
              <input
                className="input"
                type="number"
                min={0}
                max={20}
                value={form.maxRetries}
                onChange={(e) => setForm({ ...form, maxRetries: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="label">首次重试等待（毫秒）— 第一次失败后等多久再重试</label>
              <input
                className="input"
                type="number"
                min={0}
                max={600000}
                step={100}
                value={form.initialDelayMs}
                onChange={(e) => setForm({ ...form, initialDelayMs: Number(e.target.value) })}
              />
              <div className="text-xs text-gray-400 mt-1">之后每次重试的等待时间翻倍（指数退避）</div>
            </div>
            <div>
              <label className="label">最大等待时间（毫秒）— 等待上限，默认 10000</label>
              <input
                className="input"
                type="number"
                min={0}
                max={600000}
                step={500}
                value={form.maxDelayMs}
                onChange={(e) => setForm({ ...form, maxDelayMs: Number(e.target.value) })}
              />
              <div className="text-xs text-gray-400 mt-1">翻倍增长不会超过此值，防止等待过长</div>
            </div>
            <div>
              <label className="label">抖动比例（0 ~ 1，默认 0.1）</label>
              <input
                className="input"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={form.jitter}
                onChange={(e) => setForm({ ...form, jitter: Number(e.target.value) })}
              />
              <div className="text-xs text-gray-400 mt-1">
                实际等待 = 计算值 × (1±抖动) 的随机数；0 = 精确间隔，0.1 = 轻微随机，0.3 = 较高随机，1 = 完全随机
              </div>
            </div>
            <div>
              <label className="label">状态</label>
              <select className="input" value={form.enabled} onChange={(e) => setForm({ ...form, enabled: Number(e.target.value) })}>
                <option value={1}>启用</option>
                <option value={0}>停用</option>
              </select>
            </div>
            <div className="flex justify-end space-x-2 pt-2">
              <button className="btn-ghost" onClick={closeForm}>
                取消
              </button>
              <button className="btn-primary" onClick={save}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
