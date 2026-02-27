export function formatCurrency(value: number | null | undefined): string {
  const amount = Number.isFinite(value) ? Number(value) : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(value: number | null | undefined): string {
  const amount = Number.isFinite(value) ? Number(value) : 0;
  return new Intl.NumberFormat("en-US").format(amount);
}

export function formatPercent(
  value: number,
  options: { decimals?: number } = {}
): string {
  const safe = Number.isFinite(value) ? value : 0;
  const decimals = options.decimals ?? 0;
  return `${safe.toFixed(decimals)}%`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatDurationMs(value: number | null | undefined): string {
  const ms = Number.isFinite(value) ? Number(value) : 0;
  if (ms <= 0) return "0s";

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds}s`;

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

export function formatRelativeTimeDetailed(
  value: string | null | undefined,
  now = Date.now()
): string {
  if (!value) return "-";
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "-";

  const diffMs = now - then;
  const abs = Math.abs(diffMs);

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return "just now";
  if (abs < hour) {
    const m = Math.floor(abs / minute);
    return diffMs >= 0 ? `${m}m ago` : `in ${m}m`;
  }
  if (abs < day) {
    const h = Math.floor(abs / hour);
    return diffMs >= 0 ? `${h}h ago` : `in ${h}h`;
  }

  const d = Math.floor(abs / day);
  return diffMs >= 0 ? `${d}d ago` : `in ${d}d`;
}
