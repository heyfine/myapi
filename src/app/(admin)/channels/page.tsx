"use client";

import { useCallback, useEffect, useState } from "react";
import { api, time } from "@/lib/client-utils";
import ChannelModelsModal from "@/components/ChannelModelsModal";

type Channel = {
  id: number;
  name: string;
  type: string;
  baseUrl: string;
  models: string;
  modelMapping: string;
  proxy: string;
  priority: number;
  weight: number;
  status: number;
  archived: number;
  archivedAt: string | null;
  createdAt: string;
};

type ModelTestResult = { ok: boolean; latency?: number; error?: string };

const TYPE_LABELS: Record<string, string> = {
  openai: "OpenAI 官方",
  "openai-compatible": "OpenAI 兼容",
  anthropic: "Anthropic (Claude)",
  gemini: "Google Gemini",
};

const emptyForm = {
  id: 0,
  name: "",
  type: "openai-compatible",
  baseUrl: "",
  apiKey: "",
  modelsText: "",
  mappingRows: [] as Array<{ from: string; to: string }>,
  proxy: "",
  priority: 0,
  weight: 1,
  status: 1,
};

export default function ChannelsPage() {
  const [list, setList] = useState<Channel[]>([]);
  /** 视图：active 正常渠道列表；archived 归档页 */
  const [view, setView] = useState<"active" | "archived">("active");
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<Record<number, string>>({});
  const [showKey, setShowKey] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [channelTests, setChannelTests] = useState<
    Record<number, { done: number; total: number; results: Record<string, ModelTestResult> }>
  >({});
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [checkedModels, setCheckedModels] = useState<Set<string>>(new Set());
  const [modelTests, setModelTests] = useState<Record<string, { status: "running" | "ok" | "fail"; latency?: number; error?: string }>>({});
  const [testingAll, setTestingAll] = useState(false);
  /** 获取模型面板的搜索词：输入后按模型名过滤显示 */
  const [modelSearch, setModelSearch] = useState("");
  /** 模型列表浮窗：值为对应渠道，null = 关闭 */
  const [modelsModal, setModelsModal] = useState<Channel | null>(null);

  const load = useCallback(() => {
    api<{ data: Channel[] }>(view === "archived" ? "/api/channels?archived=1" : "/api/channels")
      .then((d) => setList(d.data))
      .catch((e) => setError(e.message));
  }, [view]);
  useEffect(load, [load]);

  /** 关闭浮窗并重置所有临时状态；仅通过 ✕ / ESC / 取消 触发 */
  function closeForm() {
    setForm(null);
    setFetchedModels(null);
    setCheckedModels(new Set());
    setModelTests({});
    setShowKey(false);
    setModelSearch("");
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
      // 模型映射：把可视化行收集为对象，校验留空与重复
      const mapping: Record<string, string> = {};
      for (const row of form.mappingRows) {
        const from = row.from.trim();
        const to = row.to.trim();
        if (!from && !to) continue; // 整行空白直接忽略
        if (!from || !to) throw new Error("模型映射每一行都需要同时填写\"对外的模型名\"和\"上游真实模型名\"");
        if (mapping[from]) throw new Error(`模型映射存在重复的对外模型名：${from}`);
        mapping[from] = to;
      }
      const payload = {
        name: form.name,
        type: form.type,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey || undefined,
        models: form.modelsText,
        modelMapping: mapping,
        proxy: form.proxy,
        priority: form.priority,
        weight: form.weight,
        status: form.status,
      };
      if (form.id) await api(`/api/channels/${form.id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api("/api/channels", { method: "POST", body: JSON.stringify(payload) });
      setForm(null);
      setFetchedModels(null);
      setCheckedModels(new Set());
      setModelTests({});
      setShowKey(false);
      // 归档页里复制/新建的渠道是全新未归档渠道，保存后切回列表让用户立刻看到
      if (!form.id && view === "archived") setView("active");
      else load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function toggle(c: Channel) {
    await api(`/api/channels/${c.id}`, { method: "PUT", body: JSON.stringify({ status: c.status ? 0 : 1 }) });
    load();
  }

  async function remove(c: Channel) {
    if (!confirm(`确认删除渠道「${c.name}」？`)) return;
    await api(`/api/channels/${c.id}`, { method: "DELETE" });
    load();
  }

  /** 归档：不删除配置，移出列表与网关路由，可在归档页恢复 */
  async function archive(c: Channel) {
    if (!confirm(`归档渠道「${c.name}」？归档后不再参与转发，可随时在归档页恢复。`)) return;
    await api(`/api/channels/${c.id}`, { method: "PUT", body: JSON.stringify({ archived: 1 }) });
    load();
  }

  /** 从归档页恢复到正常列表 */
  async function restore(c: Channel) {
    await api(`/api/channels/${c.id}`, { method: "PUT", body: JSON.stringify({ archived: 0 }) });
    load();
  }

  async function test(c: Channel) {    let models: string[] = [];
    try {
      models = JSON.parse(c.models);
    } catch {
      /* ignore */
    }
    if (models.length === 0) {
      setTestResult((r) => ({ ...r, [c.id]: "✗ 渠道未配置任何模型" }));
      return;
    }
    setTesting(c.id);
    setChannelTests((prev) => ({
      ...prev,
      [c.id]: { done: 0, total: models.length, results: {} },
    }));

    const results: Record<string, ModelTestResult> = {};
    let done = 0;
    const runOne = async (model: string) => {
      try {
        const res = await api<ModelTestResult>("/api/channels/test-model", {
          method: "POST",
          body: JSON.stringify({ type: c.type, baseUrl: c.baseUrl, channelId: c.id, model }),
        });
        results[model] = res;
      } catch (e) {
        results[model] = { ok: false, error: (e as Error).message };
      }
      done++;
      setChannelTests((prev) =>
        prev[c.id] ? { ...prev, [c.id]: { done, total: models.length, results: { ...results } } } : prev,
      );
    };

    // 3 个并发逐个测试全部模型
    const queue = [...models];
    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length > 0) {
          const m = queue.shift()!;
          await runOne(m);
        }
      }),
    );
    setTesting(null);
  }

  /** 测试列单元格（含进度与逐模型结果面板）：正常列表与归档页共用 */
  function renderTestCell(c: Channel) {
    return (
      <td className="td max-w-[280px]">
        <button className="btn-ghost !py-1 !px-2 text-xs" disabled={testing === c.id} onClick={() => test(c)}>
          {testing === c.id
            ? (() => {
                const t = channelTests[c.id];
                return t && t.total > 1 ? `测试中 ${t.done}/${t.total}` : "测试中";
              })()
            : (() => {
                let n = 0;
                try {
                  n = (JSON.parse(c.models) as string[]).length;
                } catch {
                  /* ignore */
                }
                return n > 1 ? `连通测试 (${n} 个模型)` : "连通测试";
              })()}
        </button>
        {testResult[c.id] && <div className="text-xs mt-1 text-gray-500">{testResult[c.id]}</div>}
        {channelTests[c.id] && (
          <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50/60 px-2 py-1">
            {(() => {
              let models: string[] = [];
              try {
                models = JSON.parse(c.models);
              } catch {
                /* ignore */
              }
              const t = channelTests[c.id];
              const okCount = models.filter((m) => t.results[m]?.ok).length;
              return (
                <>
                  <div className="text-[11px] text-gray-400 pb-1">
                    可用 {okCount} / {t.total}
                  </div>
                  {models.map((m) => {
                    const r = t.results[m];
                    return (
                      <div key={m} className="flex items-center gap-1.5 text-[11px] leading-5">
                        <span className="font-mono truncate max-w-[120px]" title={m}>
                          {m}
                        </span>
                        {!r ? (
                          <span className="text-gray-300">…</span>
                        ) : r.ok ? (
                          <span className="text-green-600 whitespace-nowrap">✓ {r.latency}ms</span>
                        ) : (
                          <span className="text-red-500 truncate max-w-[130px]" title={r.error}>
                            ✗ {r.error}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        )}
      </td>
    );
  }

  /** 复制渠道：把全部配置（含已保存的 API Key）带入新建表单 */
  async function duplicate(c: Channel) {
    let models: string[] = [];
    let mapping: Record<string, string> = {};
    let apiKey = "";
    try {
      models = JSON.parse(c.models);
    } catch {
      /* ignore */
    }
    try {
      mapping = JSON.parse(c.modelMapping) ?? {};
    } catch {
      /* ignore */
    }
    try {
      const res = await api<{ apiKey: string }>(`/api/channels/${c.id}/key`);
      apiKey = res.apiKey;
    } catch {
      /* 取不到就留空，让用户手动填 */
    }
    setForm({
      id: 0,
      name: `${c.name} 副本`,
      type: c.type,
      baseUrl: c.baseUrl,
      apiKey,
      modelsText: models.join("\n"),
      mappingRows: Object.entries(mapping).map(([from, to]) => ({ from, to })),
      proxy: c.proxy ?? "",
      priority: c.priority,
      weight: c.weight,
      status: c.status,
    });
    setShowKey(false);
    setFetchedModels(null);
    setCheckedModels(new Set());
    setModelTests({});
  }

  function edit(c: Channel) {
    let models: string[] = [];
    let mapping: Record<string, string> = {};
    try {
      models = JSON.parse(c.models);
    } catch {
      /* ignore */
    }
    try {
      mapping = JSON.parse(c.modelMapping) ?? {};
    } catch {
      /* ignore */
    }
    setForm({
      id: c.id,
      name: c.name,
      type: c.type,
      baseUrl: c.baseUrl,
      apiKey: "",
      modelsText: models.join("\n"),
      mappingRows: Object.entries(mapping).map(([from, to]) => ({ from, to })),
      proxy: c.proxy ?? "",
      priority: c.priority,
      weight: c.weight,
      status: c.status,
    });
    setShowKey(false);
    setFetchedModels(null);
    setCheckedModels(new Set());
    setModelTests({});
  }

  /** 眼睛图标：编辑时首次点击取回已保存的 key，之后切换明文/密文显示 */
  async function toggleKeyVisibility() {
    if (!form) return;
    if (form.id && !form.apiKey) {
      try {
        const res = await api<{ apiKey: string }>(`/api/channels/${form.id}/key`);
        setForm({ ...form, apiKey: res.apiKey });
        setShowKey(true);
      } catch (e) {
        alert((e as Error).message);
      }
      return;
    }
    setShowKey(!showKey);
  }

  /** 从上游供应商拉取可用模型列表，弹出让用户勾选 */
  async function fetchModels() {
    if (!form) return;
    if (!form.baseUrl) {
      alert("请先填写 Base URL");
      return;
    }
    setFetchingModels(true);
    try {
      const res = await api<{ models: string[] }>("/api/channels/fetch-models", {
        method: "POST",
        body: JSON.stringify({ type: form.type, baseUrl: form.baseUrl, apiKey: form.apiKey, channelId: form.id, proxy: form.proxy }),
      });
      if (res.models.length === 0) {
        alert("上游返回了空列表");
      } else {
        setFetchedModels(res.models);
        setCheckedModels(new Set());
        setModelTests({});
        setModelSearch("");
      }
    } catch (e) {
      alert(`获取模型失败：${(e as Error).message}`);
    }
    setFetchingModels(false);
  }

  /** 对面板中的单个模型做连通性测试 */
  async function testOneModel(model: string) {
    if (!form) return;
    setModelTests((prev) => ({ ...prev, [model]: { status: "running" } }));
    try {
      const res = await api<{ ok: boolean; latency: number; error?: string }>("/api/channels/test-model", {
        method: "POST",
        body: JSON.stringify({ type: form.type, baseUrl: form.baseUrl, apiKey: form.apiKey, channelId: form.id, model }),
      });
      setModelTests((prev) => ({
        ...prev,
        [model]: res.ok ? { status: "ok", latency: res.latency } : { status: "fail", error: res.error },
      }));
    } catch (e) {
      setModelTests((prev) => ({ ...prev, [model]: { status: "fail", error: (e as Error).message } }));
    }
  }

  /** 全部测试：并发 5 个一组，逐组完成 */
  async function testAllModels() {
    if (!form || !fetchedModels) return;
    setTestingAll(true);
    setModelTests(Object.fromEntries(fetchedModels.map((m) => [m, { status: "running" as const }])));
    const chunkSize = 5;
    for (let i = 0; i < fetchedModels.length; i += chunkSize) {
      const chunk = fetchedModels.slice(i, i + chunkSize);
      await Promise.all(chunk.map((m) => testOneModel(m)));
    }
    setTestingAll(false);
  }

  function toggleModel(model: string) {
    setCheckedModels((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  }

  /** 把勾选的模型填入文本框并关闭列表 */
  function confirmFetchedModels() {
    if (!form) return;
    const picked = (fetchedModels ?? []).filter((m) => checkedModels.has(m));
    // 与文本框中已有内容合并去重
    const existing = form.modelsText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const merged = [...new Set([...existing, ...picked])].join("\n");
    setForm({ ...form, modelsText: merged });
    setFetchedModels(null);
    setCheckedModels(new Set());
    setModelSearch("");
  }

  /** 把模型映射中的对外模型名（左列）批量并入「支持的模型」文本框，自动去重，无新增则不动 */
  function addMappingModelsToSupported() {
    if (!form) return;
    const mapped = [...new Set(form.mappingRows.map((row) => row.from.trim()).filter(Boolean))];
    const existing = form.modelsText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const added = mapped.filter((m) => !existing.includes(m));
    if (added.length === 0) return;
    setForm({ ...form, modelsText: [...existing, ...added].join("\n") });
  }

  /** 按搜索词过滤后的模型列表（空词返回全量） */
  const filteredModels = (() => {
    if (!fetchedModels) return [];
    const kw = modelSearch.trim().toLowerCase();
    return kw ? fetchedModels.filter((m) => m.toLowerCase().includes(kw)) : fetchedModels;
  })();

  const BASE_URL_HINTS: Record<string, string> = {
    openai: "https://api.openai.com",
    "openai-compatible": "例如 https://api.deepseek.com 或 https://open.bigmodel.cn/api/paas/v4",
    anthropic: "https://api.anthropic.com",
    gemini: "https://generativelanguage.googleapis.com",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{view === "archived" ? "归档" : "渠道管理"}</h1>
        <div className="flex items-center space-x-2">
          {view === "active" ? (
            <>
              <button className="btn-ghost" onClick={() => setView("archived")}>
                归档
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setFetchedModels(null);
                  setCheckedModels(new Set());
                  setModelTests({});
                  setShowKey(false);
                  setForm({ ...emptyForm });
                }}
              >
                + 新建渠道
              </button>
            </>
          ) : (
            <button className="btn-ghost" onClick={() => setView("active")}>
              返回渠道列表
            </button>
          )}
        </div>
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}

      {view === "archived" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          以下渠道已归档：不再出现在渠道列表，也不参与网关转发与统计。可编辑、复制、彻底删除或恢复。
        </div>
      )}

      {view === "active" ? (
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr>
              <th className="th">名称</th>
              <th className="th">类型</th>
              <th className="th">Base URL</th>
              <th className="th">模型</th>
              <th className="th">代理</th>
              <th className="th">优先级</th>
              <th className="th">状态</th>
              <th className="th">测试</th>
              <th className="th">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td className="td font-medium">{c.name}</td>
                <td className="td">{TYPE_LABELS[c.type] ?? c.type}</td>
                <td className="td font-mono text-xs max-w-[220px] truncate" title={c.baseUrl}>
                  {c.baseUrl}
                </td>
                <td className="td font-mono text-xs max-w-[240px]">
                  <button
                    type="button"
                    className="block w-full text-left truncate cursor-pointer hover:text-blue-600"
                    title="点击查看该渠道的全部模型"
                    onClick={() => setModelsModal(c)}
                  >
                    {(() => {
                      try {
                        return JSON.parse(c.models).join(", ");
                      } catch {
                        return c.models;
                      }
                    })()}
                  </button>
                </td>
                <td className="td font-mono text-xs max-w-[140px] truncate" title={c.proxy || undefined}>
                  {c.proxy ? (
                    <span className="badge bg-purple-50 text-purple-600 font-mono text-[10px]">
                      {c.proxy.replace(/\/\/[^@]*@/, "//***@")}
                    </span>
                  ) : (
                    <span className="text-gray-300 text-xs">直连</span>
                  )}
                </td>
                <td className="td">{c.priority}</td>
                <td className="td">
                  <span className={`badge ${c.status ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}`}>
                    {c.status ? "启用" : "停用"}
                  </span>
                </td>
                {renderTestCell(c)}
                <td className="td space-x-2 whitespace-nowrap">
                  <button className="text-blue-600 text-sm hover:underline cursor-pointer" onClick={() => edit(c)}>
                    编辑
                  </button>
                  <button
                    className="text-indigo-500 text-sm hover:underline cursor-pointer"
                    title="复制该渠道的全部配置为新渠道"
                    onClick={() => duplicate(c)}
                  >
                    复制
                  </button>
                  <button className="text-gray-500 text-sm hover:underline cursor-pointer" onClick={() => toggle(c)}>
                    {c.status ? "停用" : "启用"}
                  </button>
                  <button
                    className="text-amber-600 text-sm hover:underline cursor-pointer"
                    title="移出列表并停止转发，可在归档页恢复"
                    onClick={() => archive(c)}
                  >
                    归档
                  </button>
                  <button className="text-red-500 text-sm hover:underline cursor-pointer" onClick={() => remove(c)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td className="td text-gray-400" colSpan={9}>
                  还没有渠道，点击右上角"新建渠道"添加第一个供应商
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      ) : (
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr>
              <th className="th">名称</th>
              <th className="th">类型</th>
              <th className="th">Base URL</th>
              <th className="th">模型</th>
              <th className="th">优先级</th>
              <th className="th">状态</th>
              <th className="th">测试</th>
              <th className="th">归档时间</th>
              <th className="th">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td className="td font-medium">{c.name}</td>
                <td className="td">{TYPE_LABELS[c.type] ?? c.type}</td>
                <td className="td font-mono text-xs max-w-[220px] truncate" title={c.baseUrl}>
                  {c.baseUrl}
                </td>
                <td className="td font-mono text-xs max-w-[240px]">
                  <button
                    type="button"
                    className="block w-full text-left truncate cursor-pointer hover:text-blue-600"
                    title="点击查看该渠道的全部模型"
                    onClick={() => setModelsModal(c)}
                  >
                    {(() => {
                      try {
                        return JSON.parse(c.models).join(", ");
                      } catch {
                        return c.models;
                      }
                    })()}
                  </button>
                </td>
                <td className="td">{c.priority}</td>
                <td className="td">
                  <span className={`badge ${c.status ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}`}>
                    {c.status ? "启用" : "停用"}
                  </span>
                </td>
                {renderTestCell(c)}
                <td className="td text-xs text-gray-500 whitespace-nowrap">{c.archivedAt ? time(c.archivedAt) : "-"}</td>
                <td className="td space-x-2 whitespace-nowrap">
                  <button className="text-blue-600 text-sm hover:underline cursor-pointer" onClick={() => edit(c)}>
                    编辑
                  </button>
                  <button
                    className="text-indigo-500 text-sm hover:underline cursor-pointer"
                    title="复制该渠道的全部配置为新渠道"
                    onClick={() => duplicate(c)}
                  >
                    复制
                  </button>
                  <button className="text-green-600 text-sm hover:underline cursor-pointer" onClick={() => restore(c)}>
                    恢复
                  </button>
                  <button className="text-red-500 text-sm hover:underline cursor-pointer" onClick={() => remove(c)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td className="td text-gray-400" colSpan={9}>
                  暂无归档渠道
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {form && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="font-bold text-lg">{form.id ? "编辑渠道" : "新建渠道"}</div>
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
              <label className="label">名称</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 DeepSeek 官方" />
            </div>
            <div>
              <label className="label">类型</label>
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Base URL（填到域名即可，网关自动拼接路径）</label>
              <input className="input" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder={BASE_URL_HINTS[form.type]} />
            </div>
            <div>
              <label className="label">API Key{form.id ? "（留空表示不修改）" : ""}</label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showKey ? "text" : "password"}
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder={form.id && !form.apiKey ? "已保存（点眼睛图标查看）" : ""}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                  title={showKey ? "隐藏 Key" : "查看 Key"}
                  onClick={toggleKeyVisibility}
                >
                  {showKey ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label !mb-0">支持的模型（每行一个）</label>
                <button type="button" className="btn-ghost !py-1 !px-2 text-xs" disabled={fetchingModels} onClick={fetchModels}>
                  {fetchingModels ? "获取中..." : "获取模型"}
                </button>
              </div>
              <textarea
                className="input font-mono text-xs"
                rows={5}
                value={form.modelsText}
                onChange={(e) => setForm({ ...form, modelsText: e.target.value })}
                placeholder={form.type === "anthropic" ? "claude-sonnet-4-20250514" : form.type === "gemini" ? "gemini-2.5-pro" : "deepseek-chat\ndeepseek-reasoner"}
              />
              {fetchedModels && (
                <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/50">                  <div className="flex items-center justify-between px-3 py-2 border-b border-blue-100">
                    <label className="flex shrink-0 items-center gap-2 text-sm whitespace-nowrap cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="accent-blue-600"
                        title="勾选/取消当前搜索结果中显示的全部模型（不影响被过滤掉的勾选）"
                        checked={filteredModels.length > 0 && filteredModels.every((m) => checkedModels.has(m))}
                        onChange={(e) =>
                          setCheckedModels((prev) => {
                            const next = new Set(prev);
                            for (const m of filteredModels) {
                              if (e.target.checked) next.add(m);
                              else next.delete(m);
                            }
                            return next;
                          })
                        }
                      />
                      <span className="font-medium">全选</span>
                      <span className="text-xs text-gray-400">
                        已选 {checkedModels.size} / {fetchedModels.length}
                      </span>
                    </label>
                    <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
                      <input
                        className="input !py-1 !px-2 !text-xs !w-36"
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder="搜索模型"
                      />
                      <button
                        type="button"
                        className="btn-ghost !py-1 !px-2 text-xs"
                        disabled={testingAll}
                        onClick={testAllModels}
                      >
                        {testingAll ? "测试中..." : "全部测试"}
                      </button>
                      <button type="button" className="btn-ghost !py-1 !px-2 text-xs" onClick={() => { setFetchedModels(null); setModelTests({}); }}>
                        取消
                      </button>
                      <button
                        type="button"
                        className="btn-primary !py-1 !px-2 text-xs"
                        disabled={checkedModels.size === 0}
                        onClick={confirmFetchedModels}
                      >
                        确定
                      </button>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto px-3 py-2">
                    {filteredModels.length === 0 ? (
                      <div className="px-1 py-2 text-xs text-gray-400">无匹配模型</div>
                    ) : (
                      filteredModels.map((m) => {
                        const t = modelTests[m];
                        return (
                          <div key={m} className="flex items-center justify-between gap-2 rounded hover:bg-blue-50 px-1 py-0.5">
                            <label className="flex items-center gap-2 text-sm cursor-pointer select-none min-w-0">
                              <input
                                type="checkbox"
                                className="accent-blue-600 shrink-0"
                                checked={checkedModels.has(m)}
                                onChange={() => toggleModel(m)}
                              />
                              <span className="font-mono text-xs truncate" title={m}>{m}</span>
                            </label>
                            <div className="flex items-center gap-2 shrink-0">
                              {t?.status === "ok" && (
                                <span className="badge bg-green-100 text-green-700" title={`${t.latency}ms`}>
                                  ✓ {t.latency}ms
                                </span>
                              )}
                              {t?.status === "fail" && (
                                <span className="badge bg-red-100 text-red-700 max-w-[180px] truncate" title={t.error}>
                                  ✗ {t.error}
                                </span>
                              )}
                              {t?.status === "running" && <span className="text-xs text-gray-400">测试中...</span>}
                              <button
                                type="button"
                                className="btn-ghost !py-0.5 !px-1.5 text-xs"
                                disabled={t?.status === "running" || testingAll}
                                onClick={() => testOneModel(m)}
                              >
                                测试
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="label !mb-0 min-w-0 truncate">模型映射（可选）</label>
                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    type="button"
                    className="btn-ghost !py-1 !px-2 text-xs"
                    title="把映射左列的对外模型名批量并入「支持的模型」，自动去重"
                    disabled={!form.mappingRows.some((row) => row.from.trim())}
                    onClick={addMappingModelsToSupported}
                  >
                    添加到支持的模型
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !py-1 !px-2 text-xs"
                    onClick={() => setForm({ ...form, mappingRows: [...form.mappingRows, { from: "", to: "" }] })}
                  >
                    + 添加映射
                  </button>
                </div>
              </div>
              {form.mappingRows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-xs text-gray-400">
                  未设置映射，调用方请求什么模型名就原样转发给上游。点"添加映射"可视化配置改名规则
                </div>
              ) : (
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-500">
                    <span className="flex-1">对外的模型名（调用方请求）</span>
                    <span className="w-6 text-center">→</span>
                    <span className="flex-1">上游真实模型名（实际转发）</span>
                    <span className="w-10 text-center">操作</span>
                  </div>
                  {form.mappingRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 border-t border-gray-100">
                      <input
                        className="input !py-1 text-xs font-mono flex-1"
                        value={row.from}
                        onChange={(e) => {
                          const rows = [...form.mappingRows];
                          rows[i] = { ...rows[i], from: e.target.value };
                          setForm({ ...form, mappingRows: rows });
                        }}
                        placeholder="如 gpt-4o"
                      />
                      <span className="w-6 text-center text-gray-400">→</span>
                      <input
                        className="input !py-1 text-xs font-mono flex-1"
                        value={row.to}
                        onChange={(e) => {
                          const rows = [...form.mappingRows];
                          rows[i] = { ...rows[i], to: e.target.value };
                          setForm({ ...form, mappingRows: rows });
                        }}
                        placeholder="如 glm-4.5"
                      />
                      <div className="w-10 text-center">
                        <button
                          type="button"
                          className="text-red-400 hover:text-red-600 text-sm cursor-pointer"
                          title="删除此映射"
                          onClick={() => setForm({ ...form, mappingRows: form.mappingRows.filter((_, k) => k !== i) })}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-xs text-gray-400 mt-1">
                调用方请求左侧模型名时，网关实际转发给上游的模型会改写为右侧名称；响应中的模型名会还原为对外名称，调用方无感知
              </div>
            </div>
            <div>
              <label className="label">代理地址（可选，供应商被墙时使用）</label>
              <input
                className="input font-mono text-xs"
                value={form.proxy}
                onChange={(e) => setForm({ ...form, proxy: e.target.value })}
                placeholder="http://127.0.0.1:7890 或 socks5://user:pass@host:1080，留空直连"
              />
              <div className="text-xs text-gray-400 mt-1">
                该渠道的所有上游请求（对话转发、连通测试、获取模型）都会经过此代理
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">优先级</label>
                <input className="input" type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">权重</label>
                <input className="input" type="number" min={1} value={form.weight} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">状态</label>
                <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: Number(e.target.value) })}>
                  <option value={1}>启用</option>
                  <option value={0}>停用</option>
                </select>
              </div>
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

      {modelsModal && (
        <ChannelModelsModal
          channelName={modelsModal.name}
          models={(() => {
            try {
              const arr = JSON.parse(modelsModal.models);
              return Array.isArray(arr) ? arr.map(String) : [];
            } catch {
              // 兼容历史数据：个别渠道可能存的是逗号/换行分隔的裸文本
              return modelsModal.models
                .split(/[\n,]/)
                .map((s) => s.trim())
                .filter(Boolean);
            }
          })()}
          onClose={() => setModelsModal(null)}
        />
      )}
    </div>
  );
}
