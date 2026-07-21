import { useQuery } from '@tanstack/react-query';

const fetchHolidaysForYear = async (year) => {
  const url = `https://www.hebcal.com/hebcal?cfg=json&v=1&year=${year}&month=x&maj=on&min=on&mod=on&nx=off&s=off&c=off&i=on`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch holidays');
  const data = await res.json();
  return data.items || [];
};

// Hebcal's min=on/mod=on buckets mix real chagim u'moadim with obscure
// entries (agricultural/Talmudic dates, "eve of" markers, minor Zionist
// commemorations) that Hebcal has no separate category flag to exclude.
const EXCLUDED_TITLES = [
  'Rosh Hashana LaBehemot',
  'Yom Kippur Katan',
  'Leil Selichot',
  'Jabotinsky Day',
  'Herzl Day',
  'Ben-Gurion Day',
  'Sigd',
  'Aliyah Day',
  'Family Day',
  'Hebrew Language Day',
];

const isExcludedHoliday = (title = '') =>
  /^Erev /i.test(title) ||
  EXCLUDED_TITLES.some((excluded) => title.toLowerCase().includes(excluded.toLowerCase()));

// Maps 'yyyy-MM-dd' -> holiday label (Hebrew name, falling back to English)
export function useHolidays(years = []) {
  const uniqueYears = [...new Set(years)].sort();

  return useQuery({
    queryKey: ['holidays', uniqueYears],
    queryFn: async () => {
      const results = await Promise.all(uniqueYears.map(fetchHolidaysForYear));
      const map = {};
      results.flat().forEach((item) => {
        if (!item?.date) return;
        if (isExcludedHoliday(item.title)) return;
        const dateKey = item.date.slice(0, 10);
        const label = (item.hebrew || item.title || '').replace(/\s*\d{4}\s*$/, '');
        if (!label) return;
        map[dateKey] = map[dateKey] && !map[dateKey].includes(label)
          ? `${map[dateKey]} / ${label}`
          : (map[dateKey] || label);
      });
      return map;
    },
    enabled: uniqueYears.length > 0,
    staleTime: 1000 * 60 * 60 * 24,
  });
}
