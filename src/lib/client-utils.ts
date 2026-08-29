export async function api<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `请求失败 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function usd(quota: number): string {
  return (quota / 100000).toFixed(4).replace(/\.?0+$/, "") || "0";
}

export function time(t: string | number | null | undefined): string {
  if (!t) return "-";
  return new Date(t).toLocaleString("zh-CN", { hour12: false });
}
