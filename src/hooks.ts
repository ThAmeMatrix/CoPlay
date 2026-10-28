import { useEffect, useState } from 'react';

export function usePersistent<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try { const saved = localStorage.getItem(`coplay:${key}`); return saved === null ? initial : JSON.parse(saved); } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(`coplay:${key}`, JSON.stringify(value)); }
    catch { window.dispatchEvent(new CustomEvent('coplay:storage-error')); }
  }, [key, value]);
  return [value, setValue] as const;
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || '连接暂时不可用，请稍后重试');
  return body as T;
}
export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '00:00';
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}
export function compactNumber(n?: number) { return n === undefined ? '—' : n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n.toLocaleString(); }
