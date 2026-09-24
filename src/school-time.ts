import { config } from './config.js';

/**
 * Calendar days in the school's timezone (config.schoolTimeZone).
 *
 * Timestamps are stored in UTC. Bucketing them by UTC date put anything logged
 * between midnight and 05:30 IST on the previous day, so attendance and a
 * driver's "today" use the school's own calendar instead.
 */

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.schoolTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: config.schoolTimeZone,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric'
});

/** 'YYYY-MM-DD' of [value] in the school's timezone. */
export const schoolDateKey = (value: Date) => dayFormat.format(value);

/** How far the school's wall clock is ahead of UTC at [at], in ms. */
function zoneOffsetMs(at: Date) {
  const parts = Object.fromEntries(partsFormat.formatToParts(at).map(part => [part.type, part.value]));
  const wall = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant at which school-local midnight begins on year/month/day. */
export function schoolDayStart(year: number, month: number, day: number) {
  const utcMidnight = Date.UTC(year, month - 1, day);
  return new Date(utcMidnight - zoneOffsetMs(new Date(utcMidnight)));
}

/** Start of today in the school's timezone. */
export function schoolTodayStart(now = new Date()) {
  const [year, month, day] = schoolDateKey(now).split('-').map(Number);
  return schoolDayStart(year, month, day);
}
