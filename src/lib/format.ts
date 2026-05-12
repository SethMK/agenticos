/**
 * Number formatting helpers for stat cards.
 *
 * Keep this module tiny — only the few helpers `index.astro` actually
 * uses. Heavier formatting belongs next to the chart code, not here.
 */

/**
 * Compact-format a token count using `Intl.NumberFormat`.
 *
 * Examples:
 *   formatTokens(6_121_348_416) -> "6.12B"
 *   formatTokens(2_400_000)     -> "2.4M"
 *   formatTokens(950)           -> "950"
 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Format an amount with a currency code, two decimals.
 * Uses Intl.NumberFormat in 'currency' style, English locale.
 *
 * Examples:
 *   formatCurrency(675.67, 'EUR') -> '€675.67'
 *   formatCurrency(1234, 'USD')   -> '$1,234.00'
 */
export function formatCurrency(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format USD with a dollar sign and two decimal places.
 *
 * Examples:
 *   formatUsd(16376.958108) -> "$16,376.96"
 *   formatUsd(3.5)          -> "$3.50"
 */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Format an integer with thousands separators.
 */
export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}

/**
 * Shorten a Claude model id like `claude-opus-4-7` or
 * `claude-haiku-4-5-20251001` to a display label like `Opus 4-7`
 * or `Haiku 4-5`. Drops the leading `claude-`, drops any trailing
 * yyyymmdd suffix, and title-cases the family.
 *
 * Examples:
 *   shortModelName('claude-opus-4-7')             -> 'Opus 4-7'
 *   shortModelName('claude-haiku-4-5-20251001')   -> 'Haiku 4-5'
 *   shortModelName('claude-sonnet-4-6')           -> 'Sonnet 4-6'
 *   shortModelName('something-weird')             -> 'something-weird'
 */
export function shortModelName(id: string): string {
  if (!id || typeof id !== 'string') return '—';
  // Strip optional `claude-` prefix.
  let s = id.replace(/^claude-/i, '');
  // Drop a trailing date suffix `-YYYYMMDD` (8 digits) if present.
  s = s.replace(/-\d{8}$/, '');
  // Split into family + the rest of the version tail.
  const parts = s.split('-');
  if (parts.length === 0) return id;
  const family = parts[0]!;
  const titled = family.charAt(0).toUpperCase() + family.slice(1).toLowerCase();
  const tail = parts.slice(1).join('-');
  return tail ? `${titled} ${tail}` : titled;
}
