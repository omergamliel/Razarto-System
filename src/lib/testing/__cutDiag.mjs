// Checks that manual cuts (division_breaks as date keys, as holidayRanges
// produces them) actually reach the distribution.
import { distributeShifts } from "@/components/calendar/shiftDistributionAlgorithm";

const pad = (n) => String(n).padStart(2, "0");
const parse = (k) => new Date(`${k}T00:00:00`);
const addDay = (k) => {
  const d = parse(k);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const people = Array.from({ length: 6 }, (_, i) => ({
  serial_id: i + 1,
  full_name: `U${i + 1}`,
}));
const holidays = [
  {
    name: "קבוצה ידנית",
    start_date: "2027-04-21",
    end_date: "2027-04-25",
    divisions: 3,
    division_breaks: ["2027-04-22"],
  },
];
const res = distributeShifts({
  people,
  existingShifts: [],
  startDate: "2027-04-18",
  endDate: "2027-04-27",
  holidays,
  holidayUsers: { people, existingShifts: [], groupRepOf: new Map() },
  refine: false,
});

const byDate = new Map(res.assignments.map((a) => [a.date, a.personId]));
const line = [];
for (let d = "2027-04-21"; d <= "2027-04-25"; d = addDay(d)) {
  line.push(`${d}(${["א", "ב", "ג", "ד", "ה", "ו", "ש"][parse(d).getDay()]})→${byDate.get(d)}`);
}
console.log(line.join("  "));
console.log("skipped:", res.skipped.length, "problems:", res.skipped.map((s) => s.date));