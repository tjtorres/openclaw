/**
 * Shared time formatting utilities.
 * All timestamps in the dashboard should go through these functions.
 *
 * Timezone is configurable — defaults to browser locale but can be
 * overridden via settings (stored in localStorage).
 */

const TZ_KEY = "openclaw_timezone";

/** Get configured timezone (IANA string, e.g. "America/Los_Angeles"). */
export function getTimezone(): string {
  try {
    const stored = localStorage.getItem(TZ_KEY);
    if (stored) return stored;
  } catch {}
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Set timezone override. */
export function setTimezone(tz: string): void {
  try {
    localStorage.setItem(TZ_KEY, tz);
  } catch {}
}

/** Format a date string or timestamp as a localized time string in the configured TZ. */
export function formatTime(value: string | number | Date | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-US", {
    timeZone: getTimezone(),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Format as date + time. */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    timeZone: getTimezone(),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Format as short date (e.g. "Feb 4"). */
export function formatDate(value: string | number | Date | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    timeZone: getTimezone(),
    month: "short",
    day: "numeric",
  });
}

/** Relative time (e.g. "2 min ago", "3h ago"). Falls back to formatted time for >24h. */
export function timeAgo(value: string | number | Date | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "—";

  const diff = Date.now() - date.getTime();
  if (diff < 0) return "just now";

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  // Older than a week — show actual date
  return formatDateTime(value);
}

/** Get the timezone abbreviation (e.g. "PST", "UTC"). */
export function tzAbbrev(): string {
  try {
    const tz = getTimezone();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(new Date());
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    return tzPart?.value ?? tz;
  } catch {
    return "";
  }
}
