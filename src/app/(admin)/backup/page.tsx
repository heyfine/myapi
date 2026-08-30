"use client";

import { useState } from "react";
import { api } from "@/lib/client-utils";

type Summary = {
  channels: number;
  users: number;
  tokens: number;
  retryRules: number;
  modelPrices: number;
  logs: number;
  exportedAt?: string;
};

export default function BackupPage() {
  const [importData, setImportData] = useState<Summary | null>(null);
  const [rawData, setRawData] = useState<string>("");
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false);

  function exportBackup() {
    window.location.href = "/api/backup";
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if ((data.version !== 1 && data.version !== 2) || !Array.isArray(data.channels)) {
        throw new Error("不是有效的网关备份文件");
      }
      setImportData({
        channels: data.channels.length,
        users: (data.users ?? []).length,
        tokens: (data.tokens ?? []).length,
        retryRules: (data.retryRules ?? []).length,
        modelPrices: (data.modelPrices ?? []).length,
        logs: (data.logs ?? []).length,
        exportedAt: data.exportedAt,
      });
      setRawData(text);
    } catch (err) {
      setImportData(null);
      setRawData("");
      setError((err as Error).message);
    }
    e.target.value = ""; // 允许重复选择同一文件
  }

  async function restore() {
    if (!importData) return;
    if (
      !confirm(
        `还原将覆盖当前全部配置（渠道 ${importData.channels}、用户 ${importData.users}、令牌 ${importData.tokens}、重试规则 ${importData.retryRules}、模型定价 ${importData.modelPrices}${importData.logs > 0 ? `、调用日志 ${importData.logs} 条` : ""}），且无法撤销。确定继续？`,
      )
    ) {
      return;
    }
    setRestoring(true);
    try {
      const res = await api<{ counts: Summary }>("/api/backup/restore", {
        method: "POST",
        body: JSON.stringify({ data: JSON.parse(rawData) }),
      });
      alert(
        `还原完成：渠道 ${res.counts.channels}、用户 ${res.counts.users}、令牌 ${res.counts.tokens}、重试规则 ${res.counts.retryRules}、模型定价 ${res.counts.modelPrices}${res.counts.logs > 0 ? `、调用日志 ${res.counts.logs} 条` : ""}。请重新登录。`,
      );
      window.location.href = "/login";
    } catch (e) {
      alert(`还原失败：${(e as Error).message}`);
    }
    setRestoring(false);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">备份还原</h1>
        <p className="text-sm text-gray-500 mt-1">换电脑或迁移部署时，导出配置文件并在新环境一键还原。</p>
      </div>

      <div className="card">
        <div className="font-semibold mb-1">导出备份</div>
        <p className="text-sm text-gray-500 mb-3">
          下载包含以下内容的 JSON 文件：全部渠道（API Key 以明文包含在内，请妥善保管文件）、全部用户（含密码哈希）、
          全部 API 令牌（含哈希，还原后原令牌继续可用）、重试规则、模型定价、全部调用日志（Token 用量统计的数据源）。
        </p>
        <button className="btn-primary" onClick={exportBackup}>
          导出备份文件
        </button>
      </div>

      <div className="card">
        <div className="font-semibold mb-1">导入还原</div>
        <p className="text-sm text-gray-500 mb-3">
          选择备份文件后整库覆盖当前配置（渠道、用户、令牌、重试规则、模型定价），操作不可撤销。还原后所有用户需重新登录。
        </p>
        <input type="file" accept=".json,application/json" onChange={onFileChosen} className="text-sm" />
        {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-3">{error}</div>}
        {importData && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
            <div className="font-medium text-amber-800 mb-1">
              备份概要{importData.exportedAt ? `（导出于 ${new Date(importData.exportedAt).toLocaleString("zh-CN", { hour12: false })}）` : ""}
            </div>
            <div className="text-amber-700">
              渠道 {importData.channels} 个 · 用户 {importData.users} 个 · 令牌 {importData.tokens} 个 · 重试规则{" "}
              {importData.retryRules} 条 · 模型定价 {importData.modelPrices} 条
              {importData.logs > 0 ? ` · 调用日志 ${importData.logs} 条` : " · 不含调用日志（v1 备份）"}
            </div>
            <button className="btn-primary mt-3" disabled={restoring} onClick={restore}>
              {restoring ? "还原中..." : "确认还原（覆盖现有配置）"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
