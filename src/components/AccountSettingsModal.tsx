"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-utils";

export default function AccountSettingsModal({
  currentUsername,
  onClose,
}: {
  currentUsername: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [username, setUsername] = useState(currentUsername);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    const nameChanged = username.trim() !== currentUsername;
    const pwdChanged = newPassword.length > 0;
    if (!nameChanged && !pwdChanged) {
      setMsg({ type: "err", text: "没有要修改的内容" });
      return;
    }
    if (pwdChanged && newPassword !== confirmPassword) {
      setMsg({ type: "err", text: "两次输入的新密码不一致" });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await api<{ username: string }>("/api/auth/account", {
        method: "PATCH",
        body: JSON.stringify({
          newUsername: nameChanged ? username.trim() : undefined,
          currentPassword: pwdChanged ? currentPassword : undefined,
          newPassword: pwdChanged ? newPassword : undefined,
        }),
      });
      setMsg({ type: "ok", text: "修改成功" });
      if (nameChanged) router.refresh(); // 刷新侧边栏显示
      setTimeout(() => {
        onClose();
        if (pwdChanged) {
          // 改密后引导重新登录
          alert("密码已修改，请使用新密码重新登录");
          window.location.href = "/login";
        }
      }, 600);
      void res;
    } catch (e) {
      setMsg({ type: "err", text: (e as Error).message });
    }
    setSaving(false);
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-bold text-lg">账号设置</div>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 text-xl leading-none cursor-pointer"
            title="关闭 (Esc)"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div>
          <label className="label">用户名</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>

        <div className="border-t border-gray-100 pt-4 space-y-3">
          <div className="text-sm font-medium text-gray-600">修改密码（不需要改就留空）</div>
          <div>
            <label className="label">当前密码</label>
            <input
              className="input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="label">新密码（至少 6 位）</label>
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">确认新密码</label>
            <input
              className="input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>

        {msg && (
          <div
            className={`text-sm rounded-lg px-3 py-2 ${
              msg.type === "ok" ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="flex justify-end space-x-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" disabled={saving} onClick={save}>
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
