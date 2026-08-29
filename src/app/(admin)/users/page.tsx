"use client";

import { useCallback, useEffect, useState } from "react";
import { api, usd, time } from "@/lib/client-utils";

type User = {
  id: number;
  username: string;
  role: string;
  quota: number;
  status: number;
  createdAt: string;
};

export default function UsersPage() {
  const [list, setList] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ username: "", password: "", quotaUsd: 0, role: "user" });
  const [addAmount, setAddAmount] = useState<Record<number, string>>({});

  const load = useCallback(() => {
    api<{ data: User[] }>("/api/users")
      .then((d) => setList(d.data))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function create() {
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify(form) });
      setForm({ username: "", password: "", quotaUsd: 0, role: "user" });
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    try {
      await api(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function remove(u: User) {
    if (!confirm(`确认删除用户「${u.username}」？`)) return;
    try {
      await api(`/api/users/${u.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">用户管理</h1>
      {error && <div className="text-red-600 text-sm">{error}</div>}

      <div className="card space-y-3">
        <div className="font-semibold text-sm">创建用户</div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="label">用户名</label>
            <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div>
            <label className="label">密码</label>
            <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div>
            <label className="label">初始额度（美元）</label>
            <input className="input" type="number" min={0} value={form.quotaUsd} onChange={(e) => setForm({ ...form, quotaUsd: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">角色</label>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full" onClick={create}>
              创建
            </button>
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px]">
          <thead>
            <tr>
              <th className="th">用户名</th>
              <th className="th">角色</th>
              <th className="th">余额</th>
              <th className="th">充值（美元）</th>
              <th className="th">状态</th>
              <th className="th">创建时间</th>
              <th className="th">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                <td className="td font-medium">{u.username}</td>
                <td className="td">{u.role === "admin" ? "管理员" : "用户"}</td>
                <td className="td">${usd(u.quota)}</td>
                <td className="td">
                  <div className="flex items-center gap-1">
                    <input
                      className="input !w-24"
                      placeholder="+10"
                      value={addAmount[u.id] ?? ""}
                      onChange={(e) => setAddAmount({ ...addAmount, [u.id]: e.target.value })}
                    />
                    <button
                      className="btn-ghost !py-1 !px-2 text-xs"
                      onClick={() => {
                        const v = Number(addAmount[u.id]) || 0;
                        if (v !== 0) patch(u.id, { addUsd: v });
                        setAddAmount({ ...addAmount, [u.id]: "" });
                      }}
                    >
                      充值
                    </button>
                  </div>
                </td>
                <td className="td">
                  <span className={`badge ${u.status ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}`}>
                    {u.status ? "启用" : "禁用"}
                  </span>
                </td>
                <td className="td whitespace-nowrap">{time(u.createdAt)}</td>
                <td className="td space-x-2 whitespace-nowrap">
                  <button className="text-gray-500 text-sm hover:underline cursor-pointer" onClick={() => patch(u.id, { status: u.status ? 0 : 1 })}>
                    {u.status ? "禁用" : "启用"}
                  </button>
                  <button className="text-red-500 text-sm hover:underline cursor-pointer" onClick={() => remove(u)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
