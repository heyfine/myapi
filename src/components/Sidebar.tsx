"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import AccountSettingsModal from "./AccountSettingsModal";

type Props = {
  user: { username: string; role: string; quota: number };
};

const NAV = [
  { href: "/dashboard", label: "仪表盘", adminOnly: false },
  { href: "/channels", label: "渠道管理", adminOnly: true },
  { href: "/tokens", label: "API 令牌", adminOnly: false },
  { href: "/logs", label: "调用日志", adminOnly: false },
  { href: "/users", label: "用户管理", adminOnly: true },
  { href: "/retry-rules", label: "重试规则", adminOnly: true },
  { href: "/backup", label: "备份还原", adminOnly: true },
  { href: "/pricing", label: "模型定价", adminOnly: true },
];

export function quotaToDisplay(quota: number) {
  return (quota / 100000).toFixed(2);
}

export default function Sidebar({ user }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [showAccount, setShowAccount] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-56 shrink-0 bg-gradient-to-b from-white via-indigo-50/40 to-violet-50/60 border-r border-indigo-100/80 text-gray-600 flex flex-col sticky top-0 h-screen">
      <div className="px-5 py-5 border-b border-indigo-100/60">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-sm font-bold shadow-md shadow-indigo-500/25">
            L
          </span>
          <div className="font-bold text-lg text-gray-900 tracking-wide">LLM 网关</div>
        </div>
        <div className="text-xs text-gray-400 mt-1.5 pl-9">模型统一接入平台</div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV.filter((n) => !n.adminOnly || user.role === "admin").map((n) => {
          const active = pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                active
                  ? "bg-gradient-to-r from-indigo-100 to-violet-100 text-indigo-700 shadow-sm"
                  : "text-gray-500 hover:text-indigo-600 hover:bg-indigo-50/70"
              }`}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2.5 ${active ? "bg-indigo-500" : "bg-gray-300"}`} />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-4 border-t border-indigo-100/60">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-sm font-bold uppercase shadow-md shadow-indigo-500/20">
            {user.username.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <div className="font-medium text-gray-800 text-sm truncate">{user.username}</div>
            <div className="text-[11px] text-gray-400">
              {user.role === "admin" ? "管理员" : "用户"} · 余额 ${quotaToDisplay(user.quota)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3 text-xs">
          <button
            className="text-gray-400 hover:text-indigo-600 transition-colors cursor-pointer"
            onClick={() => setShowAccount(true)}
          >
            账号设置
          </button>
          <span className="text-gray-300">|</span>
          <button
            onClick={logout}
            className="text-gray-400 hover:text-rose-500 transition-colors cursor-pointer"
          >
            退出登录
          </button>
        </div>
      </div>
      {showAccount && <AccountSettingsModal currentUsername={user.username} onClose={() => setShowAccount(false)} />}
    </aside>
  );
}
