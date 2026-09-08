"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  /** 渠道名，展示在浮窗标题里 */
  channelName: string;
  /** 该渠道配置的全部模型 */
  models: string[];
  onClose: () => void;
};

/** 复制文本；http 非安全上下文下 clipboard API 不可用，退回 execCommand */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

/** 点击模型列弹出的浮窗：展示该渠道全部模型，支持逐个/整表复制 */
export default function ChannelModelsModal({ channelName, models, onClose }: Props) {
  const [keyword, setKeyword] = useState("");
  // 记录刚复制成功的对象：模型名（单条）或 "__all__"（整表），1.2s 后还原按钮文案
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return models;
    return models.filter((m) => m.toLowerCase().includes(kw));
  }, [models, keyword]);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  function markCopied(key: string) {
    setCopied(key);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1200);
  }

  async function handleCopy(model: string) {
    if (await copyText(model)) markCopied(model);
  }

  async function handleCopyAll() {
    // 复制的是过滤前的完整列表，与浮窗标题「全部模型」语义一致
    if (await copyText(models.join("\n"))) markCopied("__all__");
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl w-full max-w-md p-5 space-y-3 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between">
          <div className="font-bold text-base">
            模型列表 <span className="text-gray-400 font-normal text-sm">· {channelName}</span>
          </div>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 text-xl leading-none cursor-pointer"
            title="关闭 (Esc)"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-400 whitespace-nowrap">
            共 {models.length} 个模型{keyword.trim() ? `，匹配 ${filtered.length} 个` : ""}
          </span>
          <button type="button" className="btn-ghost !py-1 !px-2 text-xs" onClick={handleCopyAll}>
            {copied === "__all__" ? "已复制全部" : "复制全部"}
          </button>
        </div>

        {models.length > 8 && (
          <input
            className="input !py-1.5 text-xs font-mono"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="输入关键字过滤模型…"
          />
        )}

        <div className="border border-gray-200 rounded-lg overflow-hidden overflow-y-auto min-h-[80px]">
          {models.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-gray-400">该渠道未配置任何模型</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-gray-400">没有匹配「{keyword.trim()}」的模型</div>
          ) : (
            filtered.map((m) => (
              <div
                key={m}
                className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-gray-50 last:border-b-0 hover:bg-gray-50"
              >
                <span className="font-mono text-xs truncate" title={m}>
                  {m}
                </span>
                <button
                  type="button"
                  className="text-xs text-blue-600 hover:underline cursor-pointer shrink-0"
                  onClick={() => handleCopy(m)}
                >
                  {copied === m ? "已复制" : "复制"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
