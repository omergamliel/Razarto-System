import { addDays, format } from "date-fns";
import { holidayGroupName } from "@/lib/holidayRanges";

const todayKey = () => format(new Date(), "yyyy-MM-dd");
const keyOf = (value) => String(value || "").slice(0, 10);

// The next stretch of days a definition covers (its date, when it was added
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

// The window the divisions strip shows for a group: the next occurrence of its
// members, from the first of them to the last one that falls in the same
// stretch (a group whose entries sit months apart still previews the next run).
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
  const limit = format(addDays(new Date(`${first.start}T00:00:00`), WINDOW_DAYS), "yyyy-MM-dd");
  const inStretch = upcoming.filter((run) => run.start <= limit);
  return {
    start: first.start,
    end: inStretch.reduce((max, run) => (run.end > max ? run.end : max), first.end),
  };
}

// The holiday list of the admin section: one card per manual group (a row that
// was never grouped is a card of its own), sorted by date.
export function buildHolidayCards(definitions = [], entriesById = new Map()) {
  const cards = new Map();
  definitions.forEach((definition) => {
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
      card.isGroup = card.members.length > 1;
      return card;
    })
    .sort((a, b) => (a.date || "9999-12-31").localeCompare(b.date || "9999-12-31"));
}