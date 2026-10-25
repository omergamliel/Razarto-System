import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays } from "date-fns";

const fetchHolidaysForYear = async (year) => {
  const url = `https://www.hebcal.com/hebcal?cfg=json&v=1&year=${year}&month=x&maj=on&min=on&mod=on&nx=off&s=off&c=off&i=on`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch holidays");
  const data = await res.json();
  return data.items || [];
};

// Hebcal's min=on/mod=on buckets mix real chagim u'moadim with obscure
// entries (agricultural/Talmudic dates, "eve of" markers, minor Zionist
// commemorations) that Hebcal has no separate category flag to exclude.
const EXCLUDED_TITLES = [
  "Rosh Hashana LaBehemot",
  "Yom Kippur Katan",
  "Purim Katan",
  "Pesach Sheni",
  "Leil Selichot",
  "Jabotinsky Day",
  "Herzl Day",
  "Ben-Gurion Day",
  "Aliyah",
  "Family Day",
  "Hebrew Language Day",
  // Rosh Chodesh Tevet women's festival — not a shift-relevant chag.
  "Chag HaBanot",
];

// "Erev X" entries are noise for most minor/obscure dates, but for the major
// chagim the eve day matters for shift scheduling: the on-call shift
// effectively starts that evening, the same way Friday (Erev Shabbat)
// already starts the weekend shift — see shiftDistributionAlgorithm.js.
const EREV_CHAG_ALLOWLIST = [
  "Erev Rosh Hashana",
  "Erev Yom Kippur",
  "Erev Sukkot",
  "Erev Pesach",
  "Erev Shavuot",
];

const isAllowedErevChag = (title = "") =>
  EREV_CHAG_ALLOWLIST.some((allowed) => title.includes(allowed));

const isExcludedHoliday = (title = "") => {
  if (/^Erev /i.test(title)) return !isAllowedErevChag(title);
  return EXCLUDED_TITLES.some((excluded) =>
    title.toLowerCase().includes(excluded.toLowerCase()),
  );
};

// Chol HaMoed — the intermediate, "ordinary" days of Sukkot/Pesach — are
// tagged by Hebcal with a "(CH''M)" suffix in the title. Unlike real chag
// days these should NOT be forced into one big multi-person-excluding
// togetherness block; shiftDistributionAlgorithm treats them like regular
// days precisely so a long chag doesn't pin one person down for a week+.
const isCholHamoedTitle = (title = "") => /\(CH.*?M\)/i.test(title);

// Fetches per-year holiday data and returns:
//   - labels: 'yyyy-MM-dd' -> display label (Hebrew name, falling back to English)
//   - cholHamoedDates: Set of 'yyyy-MM-dd' dates that are Chol HaMoed
export function useHolidays(years = []) {
  const uniqueYears = [...new Set(years)].sort();

  return useQuery({
    queryKey: ["holidays", uniqueYears],
    queryFn: async () => {
      const results = await Promise.all(uniqueYears.map(fetchHolidaysForYear));
      const labels = {};
      const cholHamoedDates = new Set();
      results.flat().forEach((item) => {
        if (!item?.date) return;
        if (isExcludedHoliday(item.title)) return;
        const dateKey = item.date.slice(0, 10);
        const label = (item.hebrew || item.title || "").replace(
          /\s*\d{4}\s*$/,
          "",
        );
        if (!label) return;
        labels[dateKey] =
          labels[dateKey] && !labels[dateKey].includes(label)
            ? `${labels[dateKey]} / ${label}`
            : labels[dateKey] || label;

        if (isCholHamoedTitle(item.title)) cholHamoedDates.add(dateKey);
      });
      return { labels, cholHamoedDates };
    },
    enabled: uniqueYears.length > 0,
    staleTime: 1000 * 60 * 60 * 24,
  });
}

// Hebrew labels carry an ordinal suffix for the individual days of a multi-day
// chag ("סוכות ב׳", "פסח ג׳"). Stripping it gives the base name that ties
// those days to one holiday, so they can be listed as a single date range.
const baseHolidayName = (label = "") =>
  label.replace(/[:\s]*[א-ת]{1,2}['\u05F3]\s*$/, "").trim() || label;

// The canonical name that ties every day of ONE chag together: drops the Chol
// HaMoed marker ("סוכות ב׳ (חוה״מ)"), the counted part ("חנוכה: ב׳ נרות") and
// the day ordinal ("סוכות ז׳", "פסח ג׳"), so a whole chag collapses to a single
// name — and therefore to one holiday row covering all of its days.
const canonicalHolidayName = (label = "") => {
  const base = label.split("(")[0].split(":")[0].trim();
  return baseHolidayName(base) || base;
};

const isNextCalendarDay = (dateStr, nextStr) =>
  differenceInCalendarDays(
    new Date(`${nextStr}T00:00:00`),
    new Date(`${dateStr}T00:00:00`),
  ) === 1;

// Collapses a year's holidays into contiguous per-holiday ranges
// ({name, start_date, end_date}) so the admin Holiday list is filled with one
// row per chag. Chol HaMoed days are NOT dropped: a chag's row covers its whole
// span (פסח from its first day through its last, חנוכה as a single "חנוכה" row),
// and how many people it is shared between is the row's `divisions` — not
// something the importer decides. Excluded/obscure hebcal entries are skipped.
export async function fetchHolidayGroupsForYear(year) {
  const items = await fetchHolidaysForYear(year);
  const seen = new Set();
  const days = items
    .filter((item) => item?.date && !isExcludedHoliday(item.title))
    .map((item) => ({
      date: item.date.slice(0, 10),
      name: canonicalHolidayName(
        (item.hebrew || item.title || "").replace(/\s*\d{4}\s*$/, "").trim(),
      ),
    }))
    .filter((day) => {
      const key = `${day.name}|${day.date}`;
      if (!day.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const groups = [];
  days.forEach((day) => {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.name === day.name &&
      isNextCalendarDay(last.end_date, day.date)
    ) {
      last.end_date = day.date;
      return;
    }
    groups.push({ name: day.name, start_date: day.date, end_date: day.date });
  });
  return groups;
}