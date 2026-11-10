import { addDays, format } from "date-fns";
import { canonicalHolidayName } from "@/components/calendar/useHolidays";
import { holidayGroupName } from "@/lib/holidayRanges";
import {
  defaultDivisions,
  holidayDayKeys,
  previewHolidayShares,
} from "@/lib/holidayDivisions";

const normalizeName = (name = "") => String(name || "").trim();
const todayKey = () => format(new Date(), "yyyy-MM-dd");
const keyOf = (value) => String(value || "").slice(0, 10);

// The next stretch of days a definition covers (its own date, when it was added
// with one, always counts), or its last known occurrence.
export function nextRun(runs = []) {
  return (
    runs.find((run) => (run.end_date || run.start_date) >= todayKey()) ||
    runs[runs.length - 1] ||
    null
  );
}

export const firstDateOf = (member) =>
  keyOf(member?.definition?.date) || nextRun(member?.runs)?.start_date || "";

const WINDOW_DAYS = 45;

// The window a group shows: the next occurrence of its members, from the first
// of them to the last one that falls in the same stretch.
export function groupWindow(members = []) {
  const upcoming = members
    .map((member) => nextRun(member.runs))
    .filter(Boolean)
    .map((run) => ({
      start: run.start_date,
      end: run.end_date || run.start_date,
    }))
    .sort((a, b) => (a.start < b.start ? -1 : 1));
  const first = upcoming[0];
  if (!first) return null;
  const limit = format(
    addDays(new Date(`${first.start}T00:00:00`), WINDOW_DAYS),
    "yyyy-MM-dd",
  );
  const inStretch = upcoming.filter((run) => run.start <= limit);
  return {
    start: first.start,
    end: inStretch.reduce((max, run) => (run.end > max ? run.end : max), first.end),
  };
}

// The row that carries the group's settings (its חלוקות and its cuts).
const configOf = (members = []) =>
  members.find((member) => Number(member.definition.divisions) > 0)?.definition ||
  members[0]?.definition ||
  {};

// One card per manual group: the days of its next occurrence, the cuts between
// them, and the shares those cuts actually produce (a Friday keeps its
// Saturday, and a share is never longer than MAX_SHARE_DAYS).
export function buildHolidayCards(definitions = [], entriesById = new Map()) {
  const grouped = (definitions || []).filter(
    (definition) => normalizeName(definition.group_name),
  );
  const cards = new Map();
  grouped.forEach((definition) => {
    const key = holidayGroupName(definition);
    if (!cards.has(key)) cards.set(key, { key, members: [] });
    const entry = entriesById.get(definition.id) || {};
    cards.get(key).members.push({
      definition,
      days: entry.days || [],
      runs: entry.runs || [],
      entryNames: entry.entryNames || [],
    });
  });

  return [...cards.values()]
    .map((card) => {
      card.members.sort((a, b) => firstDateOf(a).localeCompare(firstDateOf(b)));
      card.window = groupWindow(card.members);
      card.date = card.window?.start || firstDateOf(card.members[0]) || "";
      card.dayKeys = card.window
        ? holidayDayKeys(card.window.start, card.window.end)
        : [];
      // Which chag each day of the window belongs to (for the chip label).
      card.labels = new Map();
      card.members.forEach((member) => {
        const label = member.entryNames[0] || member.definition.name;
        member.days.forEach((day) => {
          const current = card.labels.get(day);
          if (!current) card.labels.set(day, label);
          else if (!current.includes(label)) card.labels.set(day, `${current} · ${label}`);
        });
      });
      const config = configOf(card.members);
      const offsets = (config.division_breaks || []).map(Number);
      card.breaks = offsets
        .map((offset) => card.dayKeys[offset])
        .filter(Boolean);
      card.manual = offsets.length > 0;
      card.divisions = Math.max(
        1,
        Number(config.divisions) ||
          (offsets.length > 0
            ? offsets.length + 1
            : defaultDivisions(card.dayKeys.length || 1)),
      );
      card.shares = previewHolidayShares(card.dayKeys, {
        divisions: card.divisions,
        breaks: card.breaks,
      });
      return card;
    })
    .sort((a, b) => (a.date || "9999-12-31").localeCompare(b.date || "9999-12-31"));
}

// The "days not in a group" list: every holiday row that was never grouped, and
// every Hebrew-calendar entry that has no row at all yet (dropping it into a
// group creates its row).
export function buildHolidayPool(
  definitions = [],
  entriesById = new Map(),
  calendarEntries = [],
) {
  const items = [];
  (definitions || []).forEach((definition) => {
    if (normalizeName(definition.group_name)) return;
    const entry = entriesById.get(definition.id) || {};
    const days = entry.days || [];
    const run = nextRun(entry.runs || []);
    items.push({
      id: definition.id,
      definitionId: definition.id,
      name: definition.name,
      days,
      from: keyOf(definition.date) || run?.start_date || "",
      to: keyOf(definition.date) || run?.end_date || "",
      isNew: false,
    });
  });

  const known = new Set([
    ...(definitions || []).map((definition) => normalizeName(definition.name)),
    ...(definitions || []).map((definition) => normalizeName(definition.group_name)),
  ].filter(Boolean));
  const byName = new Map();
  (calendarEntries || []).forEach((entry) => {
    const name = normalizeName(entry.name);
    if (!name) return;
    const canonical = normalizeName(canonicalHolidayName(name));
    if (known.has(name) || (canonical && known.has(canonical))) return;
    const current = byName.get(name) || {
      id: `new:${name}`,
      definitionId: null,
      name,
      days: [],
      isNew: true,
    };
    holidayDayKeys(entry.start_date, entry.end_date).forEach((day) => {
      if (!current.days.includes(day)) current.days.push(day);
    });
    if (!current.from || entry.start_date < current.from) current.from = entry.start_date;
    if (!current.to || entry.end_date > current.to) current.to = entry.end_date;
    byName.set(name, current);
  });
  byName.forEach((item) => {
    item.days.sort();
    items.push(item);
  });

  return items.sort((a, b) => (a.from || "9999-12-31").localeCompare(b.from || "9999-12-31"));
}