import { useQuery } from "@tanstack/react-query";

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
