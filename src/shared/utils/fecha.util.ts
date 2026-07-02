/**
 * Helpers for working with `YYYY-MM-DD` date-only strings from Postgres `date` columns.
 *
 * Never do `new Date(fechaString)` on one of these — it parses as UTC midnight, which
 * shifts the effective local date backward a day in this app's UTC-4 timezone. Every
 * function here works from local date parts (string split or `getFullYear/Month/Date`)
 * instead, so results always match the calendar day a person in Santo Domingo expects.
 */

/** Today's date as a local `YYYY-MM-DD` string. */
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Formats a `YYYY-MM-DD` string for display, e.g. `2026-07-02` → `02/07/2026`. */
export function formatFechaDisplay(fecha: string | null | undefined): string {
  if (!fecha) return '—';
  const [y, m, d] = fecha.split('-');
  if (!y || !m || !d) return fecha;
  return `${d}/${m}/${y}`;
}

/** Whether a `YYYY-MM-DD` fecha falls within [from, to] (inclusive), both optional. */
export function isDateInRange(fecha: string, from?: string | null, to?: string | null): boolean {
  if (from && fecha < from) return false;
  if (to && fecha > to) return false;
  return true;
}

/** A `YYYY-MM-DD` string for `n` days from today (negative for the past), computed from local date parts. */
export function daysFromNowIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** A `YYYY-MM-DD` string for `n` days before today, computed from local date parts. */
export function daysAgoIso(n: number): string {
  return daysFromNowIso(-n);
}

/** The `YYYY-MM` month key of a `YYYY-MM-DD` fecha, for grouping/filtering by month. */
export function monthKey(fecha: string): string {
  return fecha.slice(0, 7);
}

/** Full years elapsed between a `YYYY-MM-DD` date and today (e.g. years of service, age). */
export function yearsSince(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  const today = new Date();
  let years = today.getFullYear() - y;
  const anniversaryPassed = today.getMonth() + 1 > m || (today.getMonth() + 1 === m && today.getDate() >= d);
  if (!anniversaryPassed) years--;
  return years;
}

/** Days from today until a `YYYY-MM-DD` date (negative if it's already past). */
export function daysUntil(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
