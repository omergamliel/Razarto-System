import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  startOfMonth,
} from "date-fns";
import { he } from "date-fns/locale";

// Sunday-first weekday headings — the same week boundaries the distribution
// works with.
export const WEEKDAY_LABELS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

// How heavy a day of each kind is, exactly as the algorithm scores it, so the
// preview's "עומס" column means the same thing as the run that produced it.
export const CATEGORY_WEIGHT = {
  holidays: 3,
  weekends: 2.5,
  thursdays: 1.5,
  regular: 1,
};

export const CATEGORY_LABELS = {
  holidays: "חגים",
  weekends: "סופ״ש",
  thursdays: "חמישי",
  regular: "רגיל",
};

// Overlay colours for the calendar cells (a day's holiday ring, an unfilled
// day, a second shift in the same week) — separate from the per-person pastel.
export const MARK_COLORS = {
  holiday: "hsl(276 45% 47%)",
  warning: "hsl(4 62% 47%)",
};

const keyOf = (value) => String(value ?? "").slice(0, 10);
const parseKey = (key) => new Date(`${keyOf(key)}T00:00:00`);
const round1 = (value) => Math.round(value * 10) / 10;

// A distinct pastel per person, stepped around the hue circle by the golden
// angle so two people next to each other in the list never look alike.
export const hueOf = (index) => Math.round((index * 137.508 + 14) % 360);
export const personColor = (hue) => `hsl(${hue} 62% 80%)`;

// "דניאל כהן" → "דני" — what fits inside a ~34px calendar cell.
export const shortName = (name) => {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  return first.slice(0, 3);
};

export const categorize = (key, holidaySet) => {
  const day = keyOf(key);
  if (holidaySet.has(day)) return "holidays";
  const dow = parseKey(day).getDay();
  if (dow === 5 || dow === 6) return "weekends";
  if (dow === 4) return "thursdays";
  return "regular";
};

/**
 * Turns a distribution result into everything the preview window shows: the
 * year calendar (a month grid per month, one cell per day) and the fairness
 * table (per person, per kind of day, against an equal share).
 *
 * Nothing here reads the database — it is purely the pending result, so it can
 * be shown (and thrown away) before a single shift is written.
 */
export function buildPreviewModel({
  assignments = [],
  skipped = [],
  weeklyOverflow = [],
  holidayKeys = [],
  people = [],
  startDate,
  endDate,
  poolSize,
}) {
  const holidaySet = new Set((holidayKeys || []).map(keyOf));
  const peopleBySerial = new Map(
    (people || []).map((person) => [Number(person.serial_id), person]),
  );
  const skippedSet = new Set((skipped || []).map((entry) => keyOf(entry.date)));
  const overflowSet = new Set((weeklyOverflow || []).map((entry) => keyOf(entry.date)));

  // Who works each day, and everyone who actually received a shift.
  const ownerByKey = new Map();
  const ids = new Set();
  (assignments || []).forEach((assignment) => {
    const key = keyOf(assignment.date);
    const id = Number(assignment.personId);
    ownerByKey.set(key, id);
    ids.add(id);
  });

  const rowsById = new Map();
  ids.forEach((id) => {
    const person = peopleBySerial.get(id);
    rowsById.set(id, {
      personId: id,
      name: person?.full_name || `#${id}`,
      group: person?.sign || "",
      total: 0,
      holidays: 0,
      weekends: 0,
      thursdays: 0,
      regular: 0,
      load: 0,
      days: [],
    });
  });

  // Colours are handed out in name order so they stay put between runs.
  const ordered = [...rowsById.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "he"),
  );
  ordered.forEach((row, index) => {
    row.hue = hueOf(index);
    row.short = shortName(row.name);
  });

  const start = parseKey(startDate);
  const end = parseKey(endDate);
  const totalDays = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const kindTotals = { holidays: 0, weekends: 0, thursdays: 0, regular: 0 };

  for (let i = 0; i < totalDays; i++) {
    const key = format(addDays(start, i), "yyyy-MM-dd");
    const category = categorize(key, holidaySet);
    kindTotals[category] += 1;
    const owner = ownerByKey.get(key);
    if (owner == null) continue;
    const row = rowsById.get(owner);
    if (!row) continue;
    row.total += 1;
    row[category] += 1;
    row.load += CATEGORY_WEIGHT[category];
    row.days.push(i);
  }

  const rows = ordered
    .map((row) => {
      let minGap = null;
      for (let k = 1; k < row.days.length; k++) {
        const gap = row.days[k] - row.days[k - 1];
        if (minGap == null || gap < minGap) minGap = gap;
      }
      return { ...row, load: round1(row.load), minGap };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "he"));

  // The equal share each person would get if the range were split evenly — the
  // baseline the "how far from fair" numbers are measured against.
  const pool = Math.max(1, Number(poolSize) || rows.length || 1);
  const fair = {
    total: round1(totalDays / pool),
    holidays: round1(kindTotals.holidays / pool),
    weekends: round1(kindTotals.weekends / pool),
    thursdays: round1(kindTotals.thursdays / pool),
    regular: round1(kindTotals.regular / pool),
  };

  const months = [];
  const rangeStart = keyOf(startDate);
  const rangeEnd = keyOf(endDate);
  const lastMonth = startOfMonth(end);
  for (
    let cursor = startOfMonth(start);
    cursor <= lastMonth;
    cursor = addMonths(cursor, 1)
  ) {
    const monthStart = startOfMonth(cursor);
    const monthTag = format(monthStart, "yyyy-MM");
    const cells = [];
    for (let blank = 0; blank < monthStart.getDay(); blank++) {
      cells.push({ id: `${monthTag}-lead-${blank}`, blank: true });
    }
    let count = 0;
    const daysInMonth = endOfMonth(monthStart).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
      const key = format(date, "yyyy-MM-dd");
      if (key < rangeStart || key > rangeEnd) {
        cells.push({ id: key, blank: true });
        continue;
      }
      const category = categorize(key, holidaySet);
      const owner = ownerByKey.get(key) ?? null;
      const row = owner != null ? rowsById.get(owner) : null;
      if (row) count += 1;
      cells.push({
        id: key,
        key,
        day,
        category,
        owner,
        short: row?.short || "",
        hue: row?.hue ?? null,
        name: row?.name || "",
        unfilled: owner == null,
        overflow: overflowSet.has(key),
        skipped: skippedSet.has(key),
        title: `${format(date, "dd/MM/yyyy")} · ${CATEGORY_LABELS[category]}${
          row?.name ? ` · ${row.name}` : " · לא מאויש"
        }`,
      });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ id: `${monthTag}-trail-${cells.length}`, blank: true });
    }
    months.push({
      key: monthTag,
      label: format(monthStart, "MMMM yyyy", { locale: he }),
      cells,
      count,
    });
  }

  return {
    months,
    rows,
    fair,
    kindTotals,
    holidaySet,
    totals: {
      assignments: (assignments || []).length,
      days: totalDays,
      people: rows.length,
      pool,
      skipped: skippedSet.size,
    },
  };
}