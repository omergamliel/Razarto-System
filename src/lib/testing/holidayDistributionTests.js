import { differenceInCalendarDays, format, startOfWeek } from "date-fns";
import { distributeShifts } from "@/components/calendar/shiftDistributionAlgorithm";
import { assert, assertEqual } from "./assert";

const weekKeyOf = (key) => format(startOfWeek(new Date(`${key}T00:00:00`), { weekStartsOn: 0 }), "yyyy-MM-dd");

// Invariants of the holiday-aware distribution: a chag group is staffed from
// the per-user pool, a share never runs longer than MAX_SHARE_DAYS, a Friday
// keeps its Saturday, and the one-regular-shift-per-week rule still holds.
function testHolidayGroupShares() {
  const people = Array.from({ length: 6 }, (_, i) => ({
    serial_id: i + 1,
    full_name: `Person ${i + 1}`,
  }));
  const startDate = "2027-04-18"; // Sunday
  const endDate = "2027-04-27";
  const chagKeys = ["2027-04-21", "2027-04-22", "2027-04-23", "2027-04-24"];

  const res = distributeShifts({
    people,
    existingShifts: [],
    startDate,
    endDate,
    holidays: [
      {
        name: "פסח",
        start_date: chagKeys[0],
        end_date: chagKeys[chagKeys.length - 1],
        divisions: 2,
      },
    ],
    holidayUsers: { people, existingShifts: [], groupRepOf: new Map() },
    refine: false,
    spreadWeekdays: false,
  });

  const byDate = new Map(res.assignments.map((a) => [a.date, a.personId]));
  const skipped = new Set(res.skipped.map((s) => s.date));

  // Every day of the range is accounted for exactly once.
  const total = differenceInCalendarDays(new Date(`${endDate}T00:00:00`), new Date(`${startDate}T00:00:00`)) + 1;
  const uniqueDates = new Set(res.assignments.map((a) => a.date));
  assertEqual(uniqueDates.size, res.assignments.length, "no day is assigned twice");
  assertEqual(uniqueDates.size + skipped.size, total, "every day is either assigned or reported as skipped");

  // The chag block is staffed, and no share runs longer than two days.
  chagKeys.forEach((key) => assert(byDate.has(key), `chag day ${key} is assigned`));
  const holders = chagKeys.map((key) => byDate.get(key));
  let run = 1;
  for (let i = 1; i < holders.length; i++) {
    run = holders[i] === holders[i - 1] ? run + 1 : 1;
    assert(run <= 2, "no one holds more than two consecutive chag days");
  }
  assertEqual(
    holders[2],
    holders[3],
    "Friday and Saturday of the chag go to the same person",
  );

  // One regular (Sun-Thu) shift per person per Sun-Sat week.
  const regularPerWeek = new Map();
  res.assignments.forEach(({ date, personId }) => {
    const dow = new Date(`${date}T00:00:00`).getDay();
    if (dow === 5 || dow === 6 || chagKeys.includes(date)) return;
    const key = `${personId}|${weekKeyOf(date)}`;
    regularPerWeek.set(key, (regularPerWeek.get(key) || 0) + 1);
  });
  [...regularPerWeek.entries()].forEach(([key, count]) =>
    assert(count <= 1, `regular shift cap holds for ${key} (got ${count})`),
  );

  // Everyone in the pool took part in the chag.
  const chagHolders = new Set(holders);
  assertEqual(chagHolders.size, 2, "two shares are handed to two different people");
}

export const holidayDistributionTests = [
  {
    id: "pure-holiday-group-shares",
    name: "distributeShifts: chag shares (≤2 days, Fri+Sat together) + weekly cap",
    category: "pure",
    run: testHolidayGroupShares,
  },
];