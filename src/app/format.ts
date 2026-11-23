export function formatTime(sec: number, precise = true): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  const base = h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  return precise ? `${base}.${String(ms).padStart(3, '0')}` : base;
}

/** Parse "1:02.5", "62.5", "1:00:02" into seconds. Returns null when invalid. */
export function parseTime(text: string): number | null {
  const t = text.trim();
  if (!/^[\d:.]+$/.test(t)) return null;
  const parts = t.split(':').map(Number);
  if (parts.some((p) => Number.isNaN(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDb(db: number): string {
  return Number.isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB';
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';
