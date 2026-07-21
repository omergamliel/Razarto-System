import { useQuery } from '@tanstack/react-query';

const fetchHolidaysForYear = async (year) => {
  const url = `https://www.hebcal.com/hebcal?cfg=json&v=1&year=${year}&month=x&maj=on&min=on&mod=on&nx=off&s=off&c=off&i=on`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch holidays');
  const data = await res.json();
  return data.items || [];
};

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
        const dateKey = item.date.slice(0, 10);
        const label = item.hebrew || item.title;
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
