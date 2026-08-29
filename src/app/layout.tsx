import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM 网关 · 模型统一接入平台",
  description: "集中管理多家模型供应商，统一 OpenAI 兼容接口",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
