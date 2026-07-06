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

/**
 * Formats a full ISO timestamp (e.g. a `timestamptz` column like `created_at`) as a local
 * calendar date, e.g. `2026-07-03T01:00:00Z` → `02/07/2026` for someone in Santo Domingo
 * (UTC-4). Do NOT `.slice(0, 10)` a timestamp before calling formatFechaDisplay — that
 * extracts the UTC calendar date, which is the wrong day for anything submitted roughly
 * 8pm–midnight local time. `new Date(timestamp)` is correct here specifically because the
 * string carries an explicit UTC offset (`Z`), unlike a bare `YYYY-MM-DD` date-only string.
 */
export function formatTimestampDisplay(timestamp: string | null | undefined): string {
  if (!timestamp) return '—';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${day}/${m}/${y}`;
}

/**
 * Formats a time-of-day string as 12-hour with AM/PM. Accepts `HH:mm` or
 * `HH:mm:ss` (Postgres `time` columns), e.g. `17:30:00` → `5:30 PM`, `08:00` → `8:00 AM`.
 */
export function formatHora12(hora: string | null | undefined): string {
  if (!hora) return '—';
  const parts = hora.split(':');
  let h = Number(parts[0]);
  const m = parts[1] ?? '00';
  if (isNaN(h)) return hora;
  const period = h >= 12 ? 'p.m.' : 'a.m.';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.padStart(2, '0')} ${period}`;
}

/**
 * Human-readable tenure since a `YYYY-MM-DD` ingreso date — accurate to the month,
 * e.g. `Menos de 1 mes`, `5 meses`, `1 año`, `2 años 3 meses`. Computed from local
 * date parts (never `new Date(dateOnlyString)`, which would shift a day in UTC-4).
 */
export function formatAntiguedad(fecha: string | null | undefined): string {
  if (!fecha) return '—';
  const [y, m, d] = fecha.split('-').map(Number);
  if (!y || !m || !d) return '—';
  const today = new Date();
  let months = (today.getFullYear() - y) * 12 + (today.getMonth() + 1 - m);
  if (today.getDate() < d) months--; // current month not yet completed
  if (months < 0) return '—';
  if (months === 0) return 'Menos de 1 mes';
  if (months < 12) return `${months} mes${months !== 1 ? 'es' : ''}`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  const yearPart = `${years} año${years !== 1 ? 's' : ''}`;
  return remMonths > 0 ? `${yearPart} ${remMonths} mes${remMonths !== 1 ? 'es' : ''}` : yearPart;
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
