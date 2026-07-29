import { addDays, differenceInCalendarDays, format, startOfWeek } from "date-fns";

// No one may be assigned more than this many shifts within a single
// (Sunday-Saturday) calendar week — tasks.txt rule (a).
const WEEKLY_CAP = 2;

const toDateKey = (date) => format(date, "yyyy-MM-dd");

// Sunday-based week key, matching the week boundaries already used
// elsewhere in the app (CalendarGrid's { weekStartsOn: 0 }).
const getWeekKey = (date) => toDateKey(startOfWeek(date, { weekStartsOn: 0 }));

// Seeds the fairness ("justice") table and the per-week shift counts from
// every existing shift a person already has — all-time for justice (so
// someone under-scheduled in the past is prioritized now), and per-week for
// the hard weekly cap (so a week that's already partly staffed before this
// run started is respected).
function initJusticeAndWeekly(people, existingShifts) {
  const justice = new Map();
  const weekly = new Map();
  people.forEach((p) => {
    justice.set(p.serial_id, 0);
    weekly.set(p.serial_id, new Map());
  });

  existingShifts.forEach((s) => {
    const personId = s.original_user_id;
    if (!justice.has(personId)) return; // not an eligible/tracked person
    justice.set(personId, justice.get(personId) + 1);

    const d = new Date(s.start_date);
    if (Number.isNaN(d.getTime())) return;
    const weekKey = getWeekKey(d);
    const perWeek = weekly.get(personId);
    perWeek.set(weekKey, (perWeek.get(weekKey) || 0) + 1);
  });

  return { justice, weekly };
}

const remainingCapacity = (weekly, personId, weekKey) =>
  WEEKLY_CAP - (weekly.get(personId)?.get(weekKey) || 0);

function recordAssignment(justice, weekly, personId, weekKey) {
  justice.set(personId, (justice.get(personId) || 0) + 1);
  const perWeek = weekly.get(personId) || new Map();
  perWeek.set(weekKey, (perWeek.get(weekKey) || 0) + 1);
  weekly.set(personId, perWeek);
}

// Picks the fairest (lowest all-time shift count) eligible person who still
// has at least `minCapacity` free slots in this specific week.
function pickCandidate(people, justice, weekly, weekKey, minCapacity, excludeIds) {
  const candidates = people
    .filter((p) => !excludeIds.has(p.serial_id))
    .map((p) => ({
      person: p,
      capacity: remainingCapacity(weekly, p.serial_id, weekKey),
      count: justice.get(p.serial_id) || 0,
    }))
    .filter((c) => c.capacity >= minCapacity)
    .sort(
      (a, b) =>
        a.count - b.count ||
        (a.person.full_name || "").localeCompare(b.person.full_name || ""),
    );
  return candidates[0]?.person || null;
}

/**
 * Distributes shifts across [startDate, endDate] as fairly as possible.
 *
 * Rules (from tasks.txt):
 *   a. No more than two shifts for one person within a single Sun-Sat week.
 *   b. Friday + Saturday go together to one person, not split.
 *   c. Same togetherness rule as (b), but for holidays.
 *
 * Only days with no existing Shift record are touched — anything already
 * assigned is left alone. Fairness ("justice") ranks people by their
 * all-time total shift count, so whoever has historically had the fewest
 * shifts is preferred for each open slot.
 *
 * Implementation note on (b)/(c): Friday/Saturday and holiday dates are
 * marked "special", and any run of *consecutive* special calendar days
 * (a weekend, a holiday, or a holiday that runs into a weekend) forms one
 * "bundle" that goes to a single person. Rule (a) is treated as a hard
 * limit, so a bundle that spans more than one Sun-Sat week — or that is
 * longer than 2 days within one week — is split at the week boundary /
 * capacity limit rather than ever exceeding the weekly cap; this only
 * matters for unusually long holiday runs and is called out in `skipped`.
 *
 * @param {Object} params
 * @param {Array<{serial_id: number, full_name: string}>} params.people - eligible people
 * @param {Array<{original_user_id: number, start_date: string}>} params.existingShifts - ALL shifts, all-time (for fairness + weekly-cap seeding)
 * @param {string} params.startDate - 'yyyy-MM-dd'
 * @param {string} params.endDate - 'yyyy-MM-dd'
 * @param {Set<string>} [params.holidayDates] - Set of 'yyyy-MM-dd' holiday dates
 * @returns {{assignments: Array<{date: string, personId: number}>, skipped: Array<{date: string, reason: string}>, justiceTable: Array<{personId: number, name: string, totalShifts: number}>}}
 */
export function distributeShifts({
  people,
  existingShifts,
  startDate,
  endDate,
  holidayDates = new Set(),
}) {
  const { justice, weekly } = initJusticeAndWeekly(people, existingShifts);

  const existingByDate = new Map();
  existingShifts.forEach((s) => existingByDate.set(s.start_date, s));

  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = differenceInCalendarDays(end, start) + 1;

  const days = [];
  for (let i = 0; i < totalDays; i++) {
    const d = addDays(start, i);
    const key = toDateKey(d);
    const dow = d.getDay(); // 0=Sun..6=Sat
    const isWeekend = dow === 5 || dow === 6; // Friday or Saturday
    days.push({
      date: d,
      key,
      weekKey: getWeekKey(d),
      isSpecial: isWeekend || holidayDates.has(key),
      existing: existingByDate.get(key) || null,
    });
  }

  // Group into bundles: consecutive "special" days form one bundle each;
  // every non-special day is its own bundle of length 1.
  const bundles = [];
  let current = null;
  days.forEach((day) => {
    if (day.isSpecial && current?.special) {
      current.days.push(day);
    } else {
      current = { special: day.isSpecial, days: [day] };
      bundles.push(current);
    }
  });

  const assignments = [];
  const skipped = [];

  bundles.forEach((bundle) => {
    // If any day in the bundle already has an owner, prefer keeping the
    // rest of the bundle with that same person (best-effort togetherness).
    const anchorShift = bundle.days.find((d) => d.existing)?.existing;
    const anchorId = anchorShift?.original_user_id ?? null;

    // A bundle can't be assigned as one block if it crosses a week boundary
    // (the weekly cap is per-week), so split it into per-week segments first.
    const segments = [];
    let seg = null;
    bundle.days.forEach((day) => {
      if (seg && seg.weekKey === day.weekKey) {
        seg.days.push(day);
      } else {
        seg = { weekKey: day.weekKey, days: [day] };
        segments.push(seg);
      }
    });

    segments.forEach((segment) => {
      const emptyDays = segment.days.filter((d) => !d.existing);
      if (emptyDays.length === 0) return;

      const anchorPerson =
        anchorId != null ? people.find((p) => p.serial_id === anchorId) : null;

      let chosen =
        anchorPerson &&
        remainingCapacity(weekly, anchorId, segment.weekKey) >= emptyDays.length
          ? anchorPerson
          : pickCandidate(people, justice, weekly, segment.weekKey, emptyDays.length, new Set()) ||
            pickCandidate(people, justice, weekly, segment.weekKey, 1, new Set());

      if (!chosen) {
        emptyDays.forEach((d) =>
          skipped.push({ date: d.key, reason: "אין עובד/ת זמין/ה עם מכסה שבועית פנויה" }),
        );
        return;
      }

      let remaining = emptyDays;
      const tried = new Set();
      while (remaining.length > 0 && chosen) {
        const capacity = remainingCapacity(weekly, chosen.serial_id, segment.weekKey);
        const toAssign = remaining.slice(0, capacity);
        toAssign.forEach((d) => {
          assignments.push({ date: d.key, personId: chosen.serial_id });
          recordAssignment(justice, weekly, chosen.serial_id, segment.weekKey);
        });
        remaining = remaining.slice(capacity);
        tried.add(chosen.serial_id);
        // Any days that didn't fit this person's remaining weekly capacity
        // (e.g. a long holiday run near everyone's cap) fall to the next
        // fairest available person instead of breaking the weekly cap.
        chosen = remaining.length > 0
          ? pickCandidate(people, justice, weekly, segment.weekKey, 1, tried)
          : null;
      }
      remaining.forEach((d) =>
        skipped.push({ date: d.key, reason: "אין עובד/ת זמין/ה עם מכסה שבועית פנויה" }),
      );
    });
  });

  return {
    assignments,
    skipped,
    justiceTable: people
      .map((p) => ({
        personId: p.serial_id,
        name: p.full_name,
        totalShifts: justice.get(p.serial_id) || 0,
      }))
      .sort((a, b) => a.totalShifts - b.totalShifts),
  };
}
