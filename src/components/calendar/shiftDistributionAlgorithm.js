import { addDays, differenceInCalendarDays, format, startOfWeek } from "date-fns";

// No one may be assigned more than this many shifts within a single
// (Sunday-Saturday) calendar week — tasks.txt rule (a).
const WEEKLY_CAP = 2;

const toDateKey = (date) => format(date, "yyyy-MM-dd");

// Sunday-based week key, matching the week boundaries already used
// elsewhere in the app (CalendarGrid's { weekStartsOn: 0 }).
const getWeekKey = (date) => toDateKey(startOfWeek(date, { weekStartsOn: 0 }));

// Seeds the fairness ("justice") table, the per-week shift counts, and each
// person's most recent assigned day — all from shifts that fall INSIDE
// [startDate, endDate] only. The algorithm intentionally has no knowledge of
// anything outside the given range: fairness is decided purely within the
// range being distributed, not by anyone's shift history before it.
function initState(people, inRangeShifts) {
  const justice = new Map();
  const weekly = new Map();
  const lastAssignedDate = new Map();
  people.forEach((p) => {
    justice.set(p.serial_id, 0);
    weekly.set(p.serial_id, new Map());
  });

  inRangeShifts.forEach((s) => {
    const personId = s.original_user_id;
    if (!justice.has(personId)) return; // not an eligible/tracked person
    justice.set(personId, justice.get(personId) + 1);

    const d = new Date(s.start_date);
    if (Number.isNaN(d.getTime())) return;
    const weekKey = getWeekKey(d);
    const perWeek = weekly.get(personId);
    perWeek.set(weekKey, (perWeek.get(weekKey) || 0) + 1);

    const prevLast = lastAssignedDate.get(personId);
    if (!prevLast || d > prevLast) lastAssignedDate.set(personId, d);
  });

  return { justice, weekly, lastAssignedDate };
}

const remainingCapacity = (weekly, personId, weekKey) =>
  WEEKLY_CAP - (weekly.get(personId)?.get(weekKey) || 0);

// New rule (spread): a person shouldn't land two calendar-adjacent days by
// accident (e.g. Tuesday then Wednesday from two unrelated decisions). This
// only looks at days already assigned so far in this run — togetherness
// bundles (rules b/c) are exempt since those are one deliberate decision, not
// an accidental back-to-back.
const isAdjacentToLastAssignment = (lastAssignedDate, personId, date) => {
  const last = lastAssignedDate.get(personId);
  if (!last) return false;
  return Math.abs(differenceInCalendarDays(date, last)) === 1;
};

function recordAssignment(justice, weekly, lastAssignedDate, personId, weekKey, date) {
  justice.set(personId, (justice.get(personId) || 0) + 1);
  const perWeek = weekly.get(personId) || new Map();
  perWeek.set(weekKey, (perWeek.get(weekKey) || 0) + 1);
  weekly.set(personId, perWeek);
  const prevLast = lastAssignedDate.get(personId);
  if (!prevLast || date > prevLast) lastAssignedDate.set(personId, date);
}

// Picks the fairest (lowest in-range shift count) eligible person who still
// has at least `minCapacity` free slots in this specific week. When
// `anchorDate` is given, candidates who'd land immediately adjacent to their
// own last-assigned day are preferred against — but only as long as that
// still leaves someone to pick; an uncomfortable spread is allowed rather
// than leaving a day unstaffed.
function pickCandidate(people, justice, weekly, weekKey, minCapacity, excludeIds, { lastAssignedDate, anchorDate } = {}) {
  const buildCandidates = (avoidAdjacent) =>
    people
      .filter((p) => !excludeIds.has(p.serial_id))
      .filter(
        (p) =>
          !avoidAdjacent ||
          !lastAssignedDate ||
          !anchorDate ||
          !isAdjacentToLastAssignment(lastAssignedDate, p.serial_id, anchorDate),
      )
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

  if (lastAssignedDate && anchorDate) {
    const comfortable = buildCandidates(true);
    if (comfortable.length > 0) return comfortable[0].person;
  }
  return buildCandidates(false)[0]?.person || null;
}

/**
 * Distributes shifts across [startDate, endDate] as fairly as possible.
 * Only shifts that fall inside this range are ever looked at — the
 * algorithm has no dependency on shift history from before `startDate`.
 *
 * Rules (from tasks.txt), all applied together:
 *   a. No more than two shifts for one person within a single Sun-Sat week.
 *   b. Friday + Saturday go together to one person, not split.
 *   c. Same togetherness rule as (b), but for holidays.
 *   d. Shifts should be spread out comfortably — a person shouldn't land two
 *      calendar-adjacent days by accident from two separate decisions.
 *
 * Only days with no existing Shift record (within the given range) are
 * touched — anything already assigned in-range is left alone. Fairness
 * ("justice") ranks people by their shift count within this range only, so
 * whoever has the fewest shifts so far in THIS distribution run is preferred
 * for each open slot.
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
 * Implementation note on (d): it's a soft preference, not a hard rule — if
 * avoiding adjacency would leave a day unstaffed, the day still gets staffed.
 *
 * @param {Object} params
 * @param {Array<{serial_id: number, full_name: string}>} params.people - eligible people
 * @param {Array<{original_user_id: number, start_date: string}>} params.existingShifts - shifts to check against; only ones inside [startDate, endDate] are used
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
  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = differenceInCalendarDays(end, start) + 1;

  // Only shifts inside the given range are relevant — this is the boundary
  // that keeps the algorithm from depending on anything before `startDate`.
  const inRangeShifts = (existingShifts || []).filter((s) => {
    if (!s.start_date) return false;
    return s.start_date >= startDate && s.start_date <= endDate;
  });

  const { justice, weekly, lastAssignedDate } = initState(people, inRangeShifts);

  const existingByDate = new Map();
  inRangeShifts.forEach((s) => existingByDate.set(s.start_date, s));

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
      const segmentAnchorDate = emptyDays[0].date;

      let chosen =
        anchorPerson &&
        remainingCapacity(weekly, anchorId, segment.weekKey) >= emptyDays.length
          ? anchorPerson
          : pickCandidate(people, justice, weekly, segment.weekKey, emptyDays.length, new Set(), {
              lastAssignedDate,
              anchorDate: segmentAnchorDate,
            }) ||
            pickCandidate(people, justice, weekly, segment.weekKey, 1, new Set(), {
              lastAssignedDate,
              anchorDate: segmentAnchorDate,
            });

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
          recordAssignment(justice, weekly, lastAssignedDate, chosen.serial_id, segment.weekKey, d.date);
        });
        remaining = remaining.slice(capacity);
        tried.add(chosen.serial_id);
        // Any days that didn't fit this person's remaining weekly capacity
        // (e.g. a long holiday run near everyone's cap) fall to the next
        // fairest available person instead of breaking the weekly cap.
        chosen = remaining.length > 0
          ? pickCandidate(people, justice, weekly, segment.weekKey, 1, tried, {
              lastAssignedDate,
              anchorDate: remaining[0].date,
            })
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
