// Smoke check for the per-person holiday division (admin groups + divisions).
import { distributeShifts } from "@/components/calendar/shiftDistributionAlgorithm";

const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (k) => new Date(`${k}T00:00:00`);
const addDay = (k) => {
  const d = parse(k);
  d.setDate(d.getDate() + 1);
  return keyOf(d);
};

const people = Array.from({ length: 9 }, (_, i) => ({
  serial_id: i + 1,
  full_name: `U${pad(i + 1)}`,
}));
// 3 shift groups of 3 people; each member is booked against its representative.
const groupRepOf = new Map();
people.forEach((p, i) => groupRepOf.set(p.serial_id, [1, 2, 3][i % 3]));

const holidays = [
  { name: "פסח", group_name: "פסח", start_date: "2027-04-21", end_date: "2027-04-24", divisions: 2 },
  { name: "שבועות", group_name: "שבועות", start_date: "2027-06-10", end_date: "2027-06-12", divisions: 3 },
];
const holidayByDate = new Set();
holidays.forEach((h) => {
  for (let d = h.start_date; d <= h.end_date; d = addDay(d)) holidayByDate.add(d);
});

const res = distributeShifts({
  people: people.filter((p) => groupRepOf.get(p.serial_id) === p.serial_id),
  existingShifts: [],
  startDate: "2027-04-18",
  endDate: "2027-06-15",
  holidays,
  holidayUsers: {
    people,
    existingShifts: [],
    groupRepOf,
  },
  refine: false,
});

const byDate = new Map(res.assignments.map((a) => [a.date, a.personId]));
const problems = [];
holidays.forEach((h) => {
  const owners = [];
  for (let d = h.start_date; d <= h.end_date; d = addDay(d)) {
    const owner = byDate.get(d);
    console.log(`${d} (${["א", "ב", "ג", "ד", "ה", "ו", "ש"][parse(d).getDay()]}) -> ${owner}`);
    if (owner == null) problems.push(`chag day unstaffed ${d}`);
    else owners.push(owner);
  }
  const distinct = new Set(owners);
  if (distinct.size > h.divisions)
    problems.push(`${h.name}: ${distinct.size} people for ${h.divisions} divisions`);
  if (distinct.size < Math.min(h.divisions, owners.length))
    problems.push(`${h.name}: only ${distinct.size} of ${h.divisions} shares used`);
});

// A chag share never runs longer than two days for one person.
holidays.forEach((h) => {
  let run = 0;
  let previous = null;
  for (let d = h.start_date; d <= h.end_date; d = addDay(d)) {
    const owner = byDate.get(d);
    if (owner == null) {
      run = 0;
      previous = null;
      continue;
    }
    run = owner === previous ? run + 1 : 1;
    previous = owner;
    if (run > 2) problems.push(`share too long ${h.name} ${d}`);
  }
});

console.log({
  holidayTableRows: res.holidayTable ? res.holidayTable.length : null,
  skipped: res.skipped.length,
  problems,
});