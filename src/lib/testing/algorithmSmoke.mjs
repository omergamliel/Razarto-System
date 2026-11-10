// Temporary smoke test for the ported distribution algorithm.
import { distributeShifts } from "@/components/calendar/shiftDistributionAlgorithm";
import {
  keepWeekendsTogether,
  splitHolidayDays,
} from "@/lib/holidayDivisions";

const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (k) => new Date(`${k}T00:00:00`);
const addDay = (k) => {
  const d = parse(k);
  d.setDate(d.getDate() + 1);
  return keyOf(d);
};
const idx = (k) => Math.round(parse(k).getTime() / 86400000);

const GROUPS = [
  ["פסח א'", "2027-04-21", "2027-04-22"],
  ["פסח ב'", "2027-04-27", "2027-04-28"],
  ["יום הזיכרון + עצמאות", "2027-05-11", "2027-05-12"],
  ["שבועות", "2027-06-10", "2027-06-11"],
  ["ראש השנה", "2027-10-01", "2027-10-03"],
  ["יום כיפור", "2027-10-10", "2027-10-11"],
  ["סוכות א'", "2027-10-15", "2027-10-16"],
  ["סוכות ב'", "2027-10-21", "2027-10-23"],
];
const holidays = GROUPS.map(([name, start_date, end_date]) => ({
  name,
  start_date,
  end_date,
  divisions: 3,
}));
const holidayKeys = new Set();
holidays.forEach((h) => {
  for (let d = h.start_date; d <= h.end_date; d = addDay(d)) holidayKeys.add(d);
});
// one Chol HaMoed day outside every group
const cholHamoedDates = new Set(["2027-04-26"]);
cholHamoedDates.forEach((k) => holidayKeys.add(k));

const people = Array.from({ length: 15 }, (_, i) => ({
  serial_id: i + 1,
  full_name: `U${pad(i + 1)}`,
}));
const protectedDates = new Map();
people.forEach((p, i) => {
  const set = new Set();
  for (let m = 0; m < 12; m++) {
    set.add(`2027-${pad(m + 1)}-${pad(((i * 7 + m * 3) % 27) + 1)}`);
  }
  protectedDates.set(p.serial_id, set);
});

const startDate = "2027-01-01";
const endDate = "2027-12-31";
const t0 = Date.now();
const res = distributeShifts({
  people,
  existingShifts: [],
  startDate,
  endDate,
  holidays,
  cholHamoedDates,
  protectedDates,
  refine: false,
});
console.log(
  "split:",
  JSON.stringify(
    splitHolidayDays(["2027-04-21", "2027-04-22", "2027-04-23", "2027-04-24"], {
      divisions: 3,
    }),
  ),
  "keep:",
  JSON.stringify(
    keepWeekendsTogether([
      ["2027-04-21", "2027-04-22"],
      ["2027-04-23"],
      ["2027-04-24"],
    ]),
  ),
  "dow23:",
  new Date("2027-04-23T00:00:00").getDay(),
  new Date("2027-04-24T00:00:00").getDay(),
);
const ms = Date.now() - t0;

const byDate = new Map(res.assignments.map((a) => [a.date, a.personId]));
const week = (k) => {
  const d = parse(k);
  d.setDate(d.getDate() - d.getDay());
  return keyOf(d);
};
const problems = [];
// 1. every day staffed, no duplicates
const allDays = [];
for (let d = startDate; d <= endDate; d = addDay(d)) allDays.push(d);
allDays.forEach((k) => {
  if (!byDate.has(k)) problems.push(`empty day ${k}`);
});
if (new Set(res.assignments.map((a) => a.date)).size !== res.assignments.length)
  problems.push("duplicate day assignment");
// 2. constraints respected
res.assignments.forEach((a) => {
  if (protectedDates.get(a.personId)?.has(a.date))
    problems.push(`constraint broken ${a.date} -> ${a.personId}`);
});
// 3. one shift per week for plain weekdays (Sun-Thu; a Fri+Sat block is the
// deliberate exception, and a weekend+weekday collision is a known preference)
const weekOwner = new Map();
res.assignments.forEach((a) => {
  if (holidayKeys.has(a.date)) return;
  const dow = parse(a.date).getDay();
  if (dow === 5 || dow === 6) return;
  const w = week(a.date);
  if (!weekOwner.has(a.personId)) weekOwner.set(a.personId, new Map());
  const m = weekOwner.get(a.personId);
  m.set(w, (m.get(w) || 0) + 1);
});
weekOwner.forEach((m, person) =>
  m.forEach((n, w) => {
    if (n > 1) problems.push(`weekly cap ${person} ${w} = ${n}`);
  }),
);
// 4. a share is at most 2 days (no 3 consecutive chag days for one person)
holidays.forEach((h) => {
  let run = 0;
  let previous = null;
  for (let d = h.start_date; d <= h.end_date; d = addDay(d)) {
    const owner = byDate.get(d);
    if (owner === previous) run += 1;
    else run = 1;
    previous = owner;
    if (run > 2) problems.push(`share too long ${h.name} ${d}`);
  }
});
// 5. Friday+Saturday together when neither is a chag
allDays.forEach((k) => {
  const d = parse(k);
  if (d.getDay() !== 5) return;
  const sat = addDay(k);
  if (sat > endDate || holidayKeys.has(k) || holidayKeys.has(sat)) return;
  if (byDate.get(k) !== byDate.get(sat))
    problems.push(`fri/sat split ${k}`);
});
// 6. chag days spread over different people
const chagCounts = new Map();
res.assignments.forEach((a) => {
  if (holidayKeys.has(a.date))
    chagCounts.set(a.personId, (chagCounts.get(a.personId) || 0) + 1);
});
const chagSpread =
  Math.max(...chagCounts.values()) - Math.min(...chagCounts.values());
const totalSpread =
  Math.max(...people.map((p) => res.assignments.filter((a) => a.personId === p.serial_id).length)) -
  Math.min(...people.map((p) => res.assignments.filter((a) => a.personId === p.serial_id).length));

const around = [];
for (let d = "2027-04-19"; d <= "2027-04-27"; d = addDay(d)) {
  around.push(
    `${d} (${["א", "ב", "ג", "ד", "ה", "ו", "ש"][parse(d).getDay()]}) -> ${byDate.get(d)}${
      holidayKeys.has(d) ? " chag" : ""
    }`,
  );
}
console.log(around.join("\n"));

console.log(
  JSON.stringify(
    {
      ms,
      assigned: res.assignments.length,
      skipped: res.skipped.length,
      relaxations: res.relaxations.length,
      weeklyOverflow: res.weeklyOverflow.length,
      weekendSpread: res.weekendSpread,
      weekdaySpread: res.weekdaySpread && {
        passes: res.weekdaySpread.passes,
        swaps: res.weekdaySpread.swaps,
      },
      chagSpread,
      totalSpread,
      justiceRows: res.justiceTable.length,
      holidayTableRows: res.holidayTable ? res.holidayTable.length : null,
      problems: problems.slice(0, 12),
      problemCount: problems.length,
    },
    null,
    2,
  ),
);