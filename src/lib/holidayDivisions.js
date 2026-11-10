import { addDays, differenceInCalendarDays, format } from "date-fns";

// The default split for a chag: TWO shifts per person. A 9-day chag therefore
// starts out divided between five people (2,2,2,2,1) and an 8-day chag between
// four (2,2,2,2). The admin can also cut the chag by hand in the holiday list.
export function defaultDivisions(dayCount) {
  const days = Math.max(0, Number(dayCount) || 0);
  if (days <= 1) return 1;
  return Math.ceil(days / 2);
}

// How many days a holiday range spans (0 while its dates aren't usable).
export function holidayDayCount(startDate, endDate) {
  if (!startDate) return 0;
  const first = new Date(`${startDate}T00:00:00`);
  const last = new Date(`${endDate || startDate}T00:00:00`);
  if (
    Number.isNaN(first.getTime()) ||
    Number.isNaN(last.getTime()) ||
    last < first
  ) {
    return 0;
  }
  return differenceInCalendarDays(last, first) + 1;
}

// Every 'yyyy-MM-dd' of a holiday range, in order.
export function holidayDayKeys(startDate, endDate) {
  const count = holidayDayCount(startDate, endDate);
  if (count === 0) return [];
  const first = new Date(`${startDate}T00:00:00`);
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    keys.push(format(addDays(first, i), "yyyy-MM-dd"));
  }
  return keys;
}

// An even split of `dayCount` days into `divisions` parts — one part per person,
// as even as possible (a 9-day chag over 4 people: 3,2,2,2).
export function planHolidayChunks(dayCount, divisions) {
  const parts = Math.min(
    Math.max(1, Math.floor(Number(divisions) || 1)),
    Math.max(1, dayCount),
  );
  const base = Math.floor(dayCount / parts);
  const extra = dayCount % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

// How a holiday's days are shared between people: consecutive days per person,
// cut where `breaks` says a new share starts, and otherwise split evenly into
// `divisions` parts. Returns one array of day keys per person — the same parts
// the distribution algorithm hands out.
export function splitHolidayDays(dayKeys, { divisions = 1, breaks = [] } = {}) {
  const keys = dayKeys || [];
  if (keys.length === 0) return [];

  const breakSet = new Set((breaks || []).filter(Boolean));
  const sizes = [];
  let size = 0;
  keys.forEach((key, index) => {
    if (index > 0 && breakSet.has(key)) {
      sizes.push(size);
      size = 0;
    }
    size += 1;
  });
  sizes.push(size);

  const cuts = sizes.filter((count) => count > 0);
  // A single cut (or none) isn't a real partition — fall back to the even split.
  const finalSizes =
    cuts.length > 1 ? cuts : planHolidayChunks(keys.length, divisions);

  const parts = [];
  let cursor = 0;
  finalSizes.forEach((count) => {
    parts.push(keys.slice(cursor, cursor + count));
    cursor += count;
  });
  return parts;
}

const parseKey = (key) => new Date(`${String(key).slice(0, 10)}T00:00:00`);
const dayIdx = (key) =>
  Math.round(
    Date.UTC(
      parseKey(key).getFullYear(),
      parseKey(key).getMonth(),
      parseKey(key).getDate(),
    ) / 86400000,
  );

// Nobody works more than this many chag days in a row. A longer share is cut
// into another share, so a chag is spread across people instead of landing as
// one long stretch. Friday+Saturday still stay together.
export const MAX_SHARE_DAYS = 2;

/**
 * Cuts every share longer than `maxDays` into shares of at most that many
 * consecutive days, never cutting between a Friday and the Saturday after it.
 *
 * @param {string[][]} parts - shares of 'yyyy-MM-dd' keys, in order
 * @returns {string[][]}
 */
export function capShareLength(parts, maxDays = MAX_SHARE_DAYS) {
  const out = [];
  (parts || []).forEach((part) => {
    const keys = part || [];
    let i = 0;
    while (i < keys.length) {
      let take = Math.min(maxDays, keys.length - i);
      while (take > 1 && i + take < keys.length) {
        const last = parseKey(keys[i + take - 1]);
        const next = parseKey(keys[i + take]);
        if (last.getDay() === 5 && next.getDay() === 6) take -= 1;
        else break;
      }
      out.push(keys.slice(i, i + take));
      i += take;
    }
  });
  return out.filter((part) => part.length > 0);
}

/**
 * Keeps a weekend inside one chag share (rules b/c). When a share boundary
 * falls between a Friday and the Saturday right after it, the Saturday moves
 * into the share that holds the Friday, so nobody comes in for a lone Saturday.
 * A share left empty by the move is dropped.
 *
 * @param {string[][]} parts - consecutive shares of 'yyyy-MM-dd' keys, in order
 * @returns {string[][]}
 */
export function keepWeekendsTogether(parts) {
  const out = parts.map((part) => [...part]).filter((part) => part.length > 0);
  for (let i = 0; i < out.length - 1; i++) {
    const last = out[i][out[i].length - 1];
    const next = out[i + 1][0];
    if (!last || !next) continue;
    const fri = parseKey(last);
    const sat = parseKey(next);
    const consecutive = dayIdx(sat) - dayIdx(fri) === 1;
    if (consecutive && fri.getDay() === 5 && sat.getDay() === 6) {
      out[i].push(out[i + 1].shift());
      if (out[i + 1].length === 0) {
        out.splice(i + 1, 1);
        i -= 1;
      }
    }
  }
  return out;
}

// Splits a run of Chol HaMoed days into two-day shares; an odd last day joins
// the share before it (a three-day share) instead of standing alone.
export function splitCholHamoed(keys) {
  const parts = [];
  for (let i = 0; i < keys.length; i += 2) parts.push(keys.slice(i, i + 2));
  if (parts.length > 1 && parts[parts.length - 1].length === 1) {
    parts[parts.length - 2].push(parts.pop()[0]);
  }
  return parts;
}

// The shares a holiday group actually ends up with: the admin's cuts (or an
// even split), never separating a Friday from its Saturday, and never longer
// than MAX_SHARE_DAYS days. This is what the admin list previews, so the
// preview and the distribution always agree.
export function previewHolidayShares(dayKeys = [], { divisions = 1, breaks = [] } = {}) {
  const keys = [...(dayKeys || [])].sort();
  if (keys.length === 0) return [];
  const parts = splitHolidayDays(keys, {
    divisions: Math.max(1, Number(divisions) || defaultDivisions(keys.length)),
    breaks,
  });
  return capShareLength(keepWeekendsTogether(parts));
}