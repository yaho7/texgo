/** Display native paths without assuming the current user's home directory. */
export function recentProjectPath(path: string): { name: string; directory: string } {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (separator < 0) return { name: path, directory: "." };
  const root = separator === 0 || (separator === 2 && /^[a-z]:/i.test(path));
  return { name: path.slice(separator + 1), directory: path.slice(0, separator + (root ? 1 : 0)) };
}

export function recentOpenedAt(openedAt: number, now = Date.now()): { label: string; iso?: string } {
  const opened = new Date(openedAt);
  if (!Number.isFinite(opened.getTime())) return { label: "时间未知" };
  const iso = opened.toISOString();
  if (!Number.isFinite(now) || openedAt > now) return { label: "时间未知", iso };
  // Calendar dates avoid 23/25-hour daylight-saving days and midnight rounding.
  const calendarDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
  const days = calendarDay(new Date(now)) - calendarDay(opened);
  if (days === 0) {
    const minutes = Math.floor((now - openedAt) / 60_000);
    return { label: minutes < 1 ? "刚刚" : minutes < 60 ? `${minutes} 分钟前` : "今天", iso };
  }
  return { label: days === 1 ? "昨天" : `${days} 天前`, iso };
}
