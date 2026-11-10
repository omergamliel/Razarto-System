import {
  canonicalHolidayName,
  fetchHolidayGroupsForYears,
} from "@/components/calendar/useHolidays";
import { defaultDivisions, holidayDayKeys } from "@/lib/holidayDivisions";

const normalizeName = (name = "") => String(name).trim();
const toDateKey = (value) => String(value || "").slice(0, 10);

// The Holiday entity stores DEFINITIONS, not one row per year: a chag entry's
// name as it appears in the Hebrew calendar plus how its shifts are divided.
// This module turns those definitions into the actual date ranges of a given
// span of years, so one row keeps working year after year.

// Every year touched by a date range, so the Hebrew calendar is asked for
// exactly the years that range needs.
export function yearsOfRange(startDate, endDate) {
  const from = String(startDate || endDate || "").slice(0, 4);
  const to = String(endDate || startDate || "").slice(0, 4);
  const first = Number(from);
  const last = Number(to);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return [];
  const years = [];
  for (let year = Math.min(first, last); year <= Math.max(first, last); year += 1) {
    years.push(year);
  }
  return years;
}

// One definition per holiday name — the general list, after collapsing any
// older per-year copies (they carry the same name) onto the most recent one.
export function holidayDefinitions(holidays = []) {
  const byName = new Map();
  holidays.forEach((holiday) => {
    const name = normalizeName(holiday?.name);
    if (!name) return;
    const kept = byName.get(name);
    if (!kept || (holiday.updated_date || "") > (kept.updated_date || "")) {
      byName.set(name, holiday);
    }
  });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "he"));
}

// The manual group a definition belongs to. A row that wasn't grouped stands
// on its own, so its own name is its group.
export function holidayGroupName(definition) {
  return normalizeName(definition?.group_name) || normalizeName(definition?.name);
}

// Sorted day keys → the date runs that are straight next to each other.
export function contiguousRuns(keys = []) {
  const runs = [];
  (keys || []).forEach((key) => {
    const last = runs[runs.length - 1];
    const previous = last ? new Date(`${last.end_date}T00:00:00`) : null;
    const day = new Date(`${key}T00:00:00`);
    const consecutive =
      previous && Math.round((day.getTime() - previous.getTime()) / 86400000) === 1;
    if (consecutive) last.end_date = key;
    else runs.push({ start_date: key, end_date: key });
  });
  return runs;
}

// An entry matches a definition by its own name, or — for a chag that is
// still listed as one row — through its canonical name ("פסח" catches "פסח ד׳
// (חוה״מ)" and "ערב פסח").
const matchesEntry = (definitionName, entryName) =>
  entryName === definitionName || canonicalHolidayName(entryName) === definitionName;

// Every definition with the days it covers in `years`: the calendar entries
// whose name matches it, plus the date it was added with. `entryNames` is the
// list of individual entries a definition stands for. `preloadedEntries` lets a
// caller reuse one Hebrew-calendar fetch for several resolutions.
export async function resolveHolidayEntries(
  definitions = [],
  years = [],
  preloadedEntries = null,
) {
  const rows = (definitions || []).filter((definition) => normalizeName(definition?.name));
  if (rows.length === 0 || (years.length === 0 && !preloadedEntries)) return [];

  const entries =
    preloadedEntries ||
    (await fetchHolidayGroupsForYears(years, { canonical: false }));
  const byDefinition = new Map(
    rows.map((definition) => [
      definition.id,
      { definition, days: new Set(), entryNames: new Set() },
    ]),
  );

  entries.forEach((entry) => {
    const entryName = normalizeName(entry.name);
    if (!entryName) return;
    byDefinition.forEach((row) => {
      if (!matchesEntry(normalizeName(row.definition.name), entryName)) return;
      holidayDayKeys(entry.start_date, entry.end_date).forEach((key) => row.days.add(key));
      row.entryNames.add(entryName);
    });
  });

  return [...byDefinition.values()]
    .map((row) => {
      const own = toDateKey(row.definition.date);
      if (own) row.days.add(own);
      const days = [...row.days].sort();
      return {
        definition: row.definition,
        entryNames: [...row.entryNames],
        days,
        runs: contiguousRuns(days),
      };
    })
    .filter((row) => row.days.length > 0);
}

const configOf = (members = []) =>
  members.find((member) => Number(member.definition.divisions) > 0)?.definition ||
  members[0]?.definition ||
  {};

// Definitions → dated holiday ranges ({name, start_date, end_date, divisions,
// division_breaks}) for the given years. Holidays grouped by hand resolve as ONE
// range per contiguous stretch, named after the group, so the group is what the
// distribution treats as a single block.
//
// `division_breaks` are stored as day OFFSETS inside the group's own list of
// days, so the cuts follow the group into every year; here they are turned into
// the actual dates the algorithm works with.
function rangesFromResolved(resolved = []) {
  const groups = new Map();
  resolved.forEach((row) => {
    const key = holidayGroupName(row.definition);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const ranges = [];
  groups.forEach((members, name) => {
    const config = configOf(members);
    const days = [...new Set(members.flatMap((member) => member.days))].sort();
    const offsets = (config.division_breaks || []).map(Number);
    contiguousRuns(days).forEach((run) => {
      const keys = holidayDayKeys(run.start_date, run.end_date);
      // Cuts are stored as day offsets inside the group's own list of days, so
      // they follow the group into every year.
      const breaks = offsets.map((offset) => keys[offset]).filter(Boolean);
      const divisions = Math.max(
        1,
        Number(config.divisions) ||
          (breaks.length > 0 ? breaks.length + 1 : defaultDivisions(keys.length)),
      );
      ranges.push({
        name,
        start_date: run.start_date,
        end_date: run.end_date,
        divisions,
        division_breaks: breaks,
      });
    });
  });
  return ranges;
}

export async function resolveHolidayRanges(definitions = [], years = []) {
  const resolved = await resolveHolidayEntries(definitions, years);
  return rangesFromResolved(resolved);
}

// Everything the distribution needs from the holiday list in one go: the dated
// ranges of the manual groups, plus the Chol HaMoed days that are NOT part of
// any holiday row — those stay "days of a chag" for the algorithm and join the
// chag beside them, while a Chol HaMoed day that IS in a row must not be pulled
// out of its own group's block.
export async function resolveDistributionHolidays(definitions = [], years = []) {
  const entries = years.length
    ? await fetchHolidayGroupsForYears(years, { canonical: false })
    : [];
  const resolved = await resolveHolidayEntries(definitions, years, entries);
  const covered = new Set(resolved.flatMap((row) => row.days));
  const cholHamoedDates = new Set();
  entries.forEach((entry) => {
    if (!entry.chm) return;
    holidayDayKeys(entry.start_date, entry.end_date).forEach((key) => {
      if (!covered.has(key)) cholHamoedDates.add(key);
    });
  });
  return { holidays: rangesFromResolved(resolved), cholHamoedDates };
}