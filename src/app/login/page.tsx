"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "登录失败");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-slate-50 to-violet-100 px-4 relative overflow-hidden">
      {/* 装饰光斑 */}
      <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-indigo-300/30 blur-3xl" />
      <div className="absolute -bottom-32 -right-20 w-[28rem] h-[28rem] rounded-full bg-violet-300/30 blur-3xl" />
      <div className="absolute top-1/3 right-1/4 w-64 h-64 rounded-full bg-sky-200/40 blur-3xl" />

      <div className="w-full max-w-sm relative">
        <div className="text-center mb-8">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-2xl font-bold shadow-xl shadow-indigo-500/30">
            L
          </div>
          <div className="text-3xl font-bold text-gray-900 mt-4 tracking-wide">LLM 网关</div>
          <p className="text-sm text-gray-500 mt-2">集中管理所有模型供应商，统一 OpenAI 兼容接口</p>
        </div>
        <form
          onSubmit={submit}
          className="rounded-2xl border border-white/60 bg-white/80 backdrop-blur p-6 space-y-4 shadow-xl shadow-indigo-200/50"
        >
          <div>
            <label className="label">用户名</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              placeholder="用户名"
            />
          </div>
          <div>
            <label className="label">密码</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
            />
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          <button className="btn-primary w-full !py-2.5" disabled={loading}>
            {loading ? "登录中..." : "登 录"}
          </button>
        </form>
      </div>
    </div>
  );
}
