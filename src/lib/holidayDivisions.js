import { addDays, differenceInCalendarDays, format } from "date-fns";

// The default split for a chag: TWO shifts per person. A 9-day chag therefore
// starts out divided between five people (2,2,2,2,1) and an 8-day chag between
// four (2,2,2,2). The admin can change the number of חלוקות or drag the
// partition between two neighbouring shares in the strip under the holiday.
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
// cut where `breaks` says a new share starts (a partition the admin moved in the
// strip), and otherwise split evenly into `divisions` parts. Returns one array of
// day keys per person — the same parts the distribution algorithm hands out.
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