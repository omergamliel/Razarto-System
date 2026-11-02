import { fetchHolidayGroupsForYears } from "@/components/calendar/useHolidays";
import { defaultDivisions, holidayDayKeys } from "@/lib/holidayDivisions";

const normalizeName = (name = "") => String(name).trim();

// The Holiday entity stores DEFINITIONS, not dates: a chag's name as it appears
// in the Hebrew calendar plus how its shifts are divided. This module turns a
// definition into the actual date ranges of a given span of years, so one row
// keeps working year after year.

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

// Resolves definitions into dated holiday records ({name, start_date,
// end_date, divisions, division_breaks}) for the given years — the same shape
// the distribution and the fairness table already work with. A definition whose
// name the Hebrew calendar doesn't know is simply not resolved.
export async function resolveHolidayRanges(definitions = [], years = []) {
  const wanted = new Map();
  (definitions || []).forEach((definition) => {
    const name = normalizeName(definition?.name);
    if (name) wanted.set(name, definition);
  });
  if (wanted.size === 0 || years.length === 0) return [];

  const groups = await fetchHolidayGroupsForYears(years);
  return groups
    .map((group) => {
      const definition = wanted.get(normalizeName(group.name));
      if (!definition) return null;
      const days = holidayDayKeys(group.start_date, group.end_date);
      // Breaks are stored as day offsets, so they follow the chag into every
      // year no matter which weekday it starts on.
      const breaks = (definition.division_breaks || [])
        .map((offset) => days[Number(offset)])
        .filter(Boolean);
      const divisions = Math.max(
        1,
        Number(definition.divisions) ||
          (breaks.length > 0 ? breaks.length + 1 : defaultDivisions(days.length)),
      );
      return {
        name: group.name,
        start_date: group.start_date,
        end_date: group.end_date,
        divisions,
        division_breaks: breaks,
      };
    })
    .filter(Boolean);
}