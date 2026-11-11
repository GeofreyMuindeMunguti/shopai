/** Display formatting helpers (prices, times, masked emails). */

const CURRENCY_PREFIX: Record<string, string> = {
  KES: 'KSh ',
  USD: 'US$',
  ZAR: 'R',
};

/** "US$129", "KSh 16,700", "R4,199". Unknown currencies fall back to Intl. */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined, opts?: { approx?: boolean }): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '—';
  const value = Number(amount);
  const code = (currency ?? '').toUpperCase();
  const digits = opts?.approx || Number.isInteger(value) ? 0 : 2;
  const prefix = CURRENCY_PREFIX[code];
  if (prefix) {
    return `${prefix}${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code || 'USD', maximumFractionDigits: digits }).format(value);
  } catch {
    return `${code} ${value.toFixed(digits)}`;
  }
}

/** Rounds to 3 significant figures for "≈" conversions (16,734 → 16,700). */
export function roundApprox(value: number): number {
  if (value === 0) return 0;
  const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.abs(value))) - 2));
  return Math.round(value / magnitude) * magnitude;
}

export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** "jane.doe@gmail.com" → "j***@gmail.com" */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `${local.slice(0, 1)}***@${domain}`;
}

export function formatPercent(score: number | null | undefined): string {
  if (score === null || score === undefined) return '—';
  return `${Math.round(Number(score) * 100)}%`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-US');
}

export const ITEM_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  scouting: 'Scouting…',
  candidates_ready: 'Matches ready',
  no_matches: 'No matches',
  approved: 'Approved',
  archived: 'Archived',
};

export const AVAILABILITY_LABEL: Record<string, string> = {
  in_stock: 'In stock',
  out_of_stock: 'Out of stock',
  preorder: 'Pre-order',
  unknown: 'Availability unknown',
};
