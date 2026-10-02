/**
 * Date/Time formatting and helper utilities for TerraByte ETA and completion values.
 * Standardizes machine-readable ISO timestamps while displaying clean, human-friendly formats.
 */

function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !isNaN(d.getTime());
}

/**
 * Formats a Date object into local HTML5 datetime-local string (YYYY-MM-DDTHH:mm).
 */
export function toDateTimeLocalString(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Normalizes any existing value (ISO string, legacy free-text, or null) to a valid datetime-local string.
 * If unparseable or absent, falls back to a clean default in the future (e.g. tomorrow at 09:30 or now + offset).
 */
export function valueToDateTimeLocal(value?: string | null, defaultOffsetHours: number = 24): string {
  if (value && typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      const parsed = new Date(trimmed);
      if (isValidDate(parsed)) {
        return toDateTimeLocalString(parsed);
      }
    }
  }

  const fallback = new Date();
  fallback.setHours(fallback.getHours() + defaultOffsetHours);
  fallback.setMinutes(fallback.getMinutes() >= 30 ? 30 : 0);
  fallback.setSeconds(0);
  fallback.setMilliseconds(0);
  return toDateTimeLocalString(fallback);
}

/**
 * Formats an ETA or completion timestamp into a clean, human-readable display string:
 * - "Today, 9:30 AM"
 * - "Tomorrow, 9:30 AM"
 * - "Oct 3, 2026, 9:30 AM"
 * 
 * Gracefully preserves legacy free-text strings (e.g. "Tomorrow", "Tomorrow, 9:30 AM") without crashing.
 */
export function formatEtaDateTime(value?: string | null): string {
  if (!value) return "TBD";
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "TBD";

  const date = new Date(trimmed);
  if (!isValidDate(date)) {
    // Preserve legacy free-text as-is
    return trimmed;
  }

  const timeStr = date.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((targetDay.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) {
    return `Today, ${timeStr}`;
  }
  if (diffDays === 1) {
    return `Tomorrow, ${timeStr}`;
  }

  const isSameYear = date.getFullYear() === now.getFullYear();
  const dateStr = date.toLocaleDateString("en-IN", {
    month: "short",
    day: "numeric",
    ...(isSameYear ? {} : { year: "numeric" }),
  });

  return `${dateStr}, ${timeStr}`;
}

/**
 * Creates preset dates for rapid technician ETA selection.
 */
export function getEtaPresets() {
  const now = new Date();

  // Preset 1: +4 hours (rounded to 30 mins)
  const in4Hours = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  in4Hours.setMinutes(in4Hours.getMinutes() >= 30 ? 30 : 0);

  // Preset 2: Tomorrow at 9:30 AM
  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(9, 30, 0, 0);

  // Preset 3: Tomorrow at 5:00 PM
  const tomorrowEvening = new Date(now);
  tomorrowEvening.setDate(tomorrowEvening.getDate() + 1);
  tomorrowEvening.setHours(17, 0, 0, 0);

  // Preset 4: 2 days at 12:00 PM
  const in2Days = new Date(now);
  in2Days.setDate(in2Days.getDate() + 2);
  in2Days.setHours(12, 0, 0, 0);

  return [
    { label: "+4 hours", iso: in4Hours.toISOString(), local: toDateTimeLocalString(in4Hours) },
    { label: "Tomorrow 9:30 AM", iso: tomorrowMorning.toISOString(), local: toDateTimeLocalString(tomorrowMorning) },
    { label: "Tomorrow 5:00 PM", iso: tomorrowEvening.toISOString(), local: toDateTimeLocalString(tomorrowEvening) },
    { label: "2 days", iso: in2Days.toISOString(), local: toDateTimeLocalString(in2Days) },
  ];
}
