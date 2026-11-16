import { addDays, differenceInCalendarDays } from "date-fns";
import {
  MAX_SHARE_DAYS,
  capShareLength,
  keepWeekendsTogether,
  splitCholHamoed,
  splitHolidayDays,
} from "@/lib/holidayDivisions";
import { refineSpacing } from "@/components/calendar/spacingRefinement";
import {
  MAX_TOTAL_SPREAD,
  applyHistory,
  categorizeDay,
  computeIdealGaps,
  dayIndex,
  emptyCats,
  getWeekKey,
  initState,
  makeRng,
  nearestGap,
  parseDateKey,
  pickCandidate,
  pickTogetherCandidate,
  recordAssignment,
  remainingCapacity,
  toDateKey,
} from "@/components/calendar/distributionCore";
import {
  compareRuns,
  optimizeDistribution,
  spacingScore,
  spreadWeekdayShifts,
  spreadWeekendShifts,
} from "@/components/calendar/distributionSpreads";

// How far back the passes after the greedy one look for shifts before the
// range (history.lookbackDays overrides it) — the same default as
// applyHistory's lookback in distributionCore.
const PAST_LOOKBACK_DAYS = 42;

// A holiday share is cut by splitHolidayDays (its חלוקות value or the cuts the
// admin moved in the holiday list), kept together across a Friday/Saturday and
// capped at MAX_SHARE_DAYS days — see src/lib/holidayDivisions.js.
export {
  MAX_SHARE_DAYS,
  capShareLength,
  keepWeekendsTogether,
  splitCholHamoed,
  // post-passes, re-exported for callers that use them on their own
  spreadWeekdayShifts,
  spreadWeekendShifts,
  optimizeDistribution,
  spacingScore,
  compareRuns,
};

/**
 * Runs distributeShifts several times with different seeds (each run breaks
 * ties differently, and its week-spacing search starts differently) and keeps
 * the calendar with the best week spacing — see compareRuns for the order.
 *
 * @param {Object} params - the same parameters as distributeShifts
 * @param {{runs?: number, seed?: number, iterations?: number, onRun?: (summary) => void}} [options]
 * @returns the best run's distributeShifts result, plus `search: {best, runs}`
 */
export function distributeShiftsBest(params, { runs = 4, seed = 1, iterations, onRun } = {}) {
  let best = null;
  const summaries = [];
  for (let r = 0; r < runs; r++) {
    const result = distributeShifts({ ...params, seed: seed + r * 7919, ...(iterations ? { weekIterations: iterations } : {}) });
    const summary = { run: r, seed: seed + r * 7919, empty: result.skipped.length, swaps: result.weekSpacing.swaps, ...result.weekSpacing.after };
    delete summary.perPerson;
    summaries.push(summary);
    if (onRun) onRun(summary);
    if (!best || compareRuns(summary, best.summary) < 0) best = { result, summary };
  }
  return { ...best.result, search: { best: best.summary.run, runs: summaries } };
}

/**
 * Distributes shifts across [startDate, endDate] as fairly as possible.
 *
 * Rules, all applied together:
 *   a. One shift per person per Sun–Sat week (a Fri+Sat / chag block is the
 *      deliberate exception and still counts as that person's unit for the week).
 *   b. Friday + Saturday go together to one person, not split.
 *   c. A chag block — erev, chag, Chol HaMoed and any weekend among them — is
 *      divided into shares (the chag's חלוקות, or the cuts the admin set),
 *      each share to one person. A Friday keeps its Saturday, a share is at
 *      most MAX_SHARE_DAYS days, and a share goes to someone free on all its
 *      days whenever possible. Shares go strictly by count: first to the
 *      people with the fewest chag days including their history carry (past
 *      chags beyond their fair share — history.fairnessKinds, by default
 *      chags only), so whoever worked more chags in the past waits until the
 *      others have caught up. With holidayUsers, the carry comes from
 *      holidayUsers.history, or from history when that's not given.
 *   d. A person shouldn't land two calendar-adjacent days by accident.
 *   e. Total shifts stay balanced: nobody is handed a slot while someone
 *      available holds more than MAX_TOTAL_SPREAD fewer, or after reaching
 *      their range quota (ceil(days / people)).
 *   f. Each kind of day is spaced per person against an ideal gap derived from
 *      how often that kind occurs in the range.
 *   g. Thursdays and ordinary days are spread from every other shift of that
 *      person by swapping same-kind shifts (spreadWeekdayShifts).
 *   h. No day is left empty while someone without a constraint could work it
 *      (a last resort: a second shift that week, or a split weekend/chag day).
 *   i. Weekends are spread evenly over each person's AVAILABLE time (the days
 *      they didn't block), chag shares included as fixed points:
 *        - weekends are staffed in date order, each offered first to the
 *          people most overdue for one (their share of weekends plus their own
 *          chag shares, spread over their available days, minus what they
 *          already hold);
 *        - then, before any weekday is handed out, a weekend-only search swaps
 *          (and, within the fairness band, hands over) whole weekends between
 *          people so each person's weekends and chag shares are evenly apart
 *          in their available days — a blocked month is not counted as rest;
 *        - the final week search (rule k) keeps them even (heavyEvenWeight).
 *      The old calendar-based pass (spreadWeekendShifts) only runs when this
 *      is switched off (weekendRotation: false).
 *   j. A weekly rhythm is discouraged: shifts exactly a week apart, and shifts
 *      in two consecutive Sun–Sat weeks. A soft preference only — it breaks
 *      ties in fairness (see weekRhythm) and is optimised again by the
 *      week-spacing search (rule k), never enforced.
 *   k. Week spacing (optimizeDistribution): after the spreading passes, whole
 *      shifts are moved between people to minimise, per person, shifts in the
 *      same week, in back-to-back weeks, and with only one empty week between
 *      them, and then short gaps. Three moves:
 *        - swap units of the same kind (a Thursday for a Thursday, an ordinary
 *          day for an ordinary day, a weekend for a weekend, a chag share for a
 *          chag share of the same make-up);
 *        - swap a Thursday for an ordinary day;
 *        - give one Thursday, ordinary day or weekend to another person.
 *      The last two change who has how many, so they are allowed only while
 *      everyone's total days and their Thursdays, ordinary days and weekends
 *      stay inside the band (min..max over everyone) the distribution already
 *      has: the fairness spread never grows. This matters with long
 *      constraints: a person blocked for weeks can end up at the low end of
 *      the band instead of crammed into the weeks they have left. Chag shares
 *      only ever swap like for like, so chag counts never change. Constraints
 *      and the one-shift-per-week rule are kept. Annealing (weekIterations
 *      random moves) keeps it from stopping at the first dead end. Pass
 *      optimizeWeeks: false to skip it.
 *      Shifts from the lookback window before the range (history.shifts and
 *      existingShifts, history.lookbackDays, default 42 days) are fixed points
 *      for this search and for the spreading passes (g, i): every gap and week
 *      rule is measured against them, so a range planned on its own — a month
 *      at a time — doesn't start someone right after the last shift they had
 *      in the previous one. They never move and never count in this range's
 *      fairness band.
 *      Order: greedy pass → last resort (h) → refineSpacing → weekends (i) →
 *      Thursdays/ordinary days (g) → week spacing (k). The week search runs
 *      last, so nothing after it can undo its week rules.
 *      Close gaps are spread over people, not piled on a few: the k-th time
 *      the same person has a one-week gap (beyond their allowance, rule l)
 *      costs k × 150, so a 5th one for one person costs more than a 1st for
 *      someone else. Three shifts within four weeks (x.x.x) is a burst and
 *      escalates too (k × 300), so extra shifts alternate with normal gaps
 *      (x..x.x..x.x) instead of coming in a run. Two heavy shifts (weekends
 *      and chag shares) of the same person 3 weeks apart or less cost
 *      k × 2500. Back-to-back (5000 × k) and same week (20000 × k) stay far
 *      above all of those, so the search never trades one for them.
 *      Count fairness inside the search: each person's distance from the
 *      average in total days, weekends, Thursdays and ordinary days costs
 *      countFairness × distance², so moves that even out the counts are
 *      preferred; and no move may take anyone outside the CURRENT min..max
 *      of any count, so the spreads can only stay or shrink.
 *   l. Constraints cost their owner, in proportion (part of k): someone with
 *      constraints gets fewer weeks to fit the same shifts into, so they get
 *      more one-week gaps — as many as their blocked time explains, no more:
 *      each week of their blocked days (blocked / 7) gives them an allowance
 *      of gapAllowancePerWeek (1) one-week gap at a flat price; beyond that
 *      their gaps escalate exactly like anyone else's. So the crowding nobody
 *      can avoid is shared equally, a short vacation costs about what one week
 *      of 53 should, and nobody — constrained or not — is made the cheap place
 *      to put extra shifts. The evenness of short gaps is also weighted by
 *      1 / (1 + blocked days / constraintWeightDays), blocked days scaled to a
 *      year. Back-to-back, same week and bursts count in full for everyone.
 *
 * Rules (d), (e) and (f) are soft: they are relaxed in the order f → e → d only
 * when no candidate satisfies them, so a day is never left unstaffed because of
 * them. Every relaxation is reported in `relaxations`.
 *
 * @param {Object} params
 * @param {Array<{serial_id: number, full_name: string}>} params.people
 * @param {Array<{original_user_id: number, start_date: string}>} params.existingShifts
 * @param {string} params.startDate - 'yyyy-MM-dd'
 * @param {string} params.endDate - 'yyyy-MM-dd'
 * @param {Set<string>} [params.holidayDates]
 * @param {Set<string>} [params.cholHamoedDates]
 * @param {Map<string, number>} [params.holidayDivisions]
 * @param {Array<{name: string, start_date: string, end_date?: string, divisions?: number, division_breaks?: string[]}>} [params.holidays]
 * @param {Map<number, Set<string>>} [params.protectedDates]
 * @param {Map<number, number>} [params.priorJustice]
 * @param {Object} [params.history]
 * @param {{people: Array, existingShifts?: Array, groupRepOf?: Map<number, number>, protectedDates?: Map<number, Set<string>>, history?: Object}} [params.holidayUsers]
 */
export function distributeShifts({
  people,
  existingShifts,
  startDate,
  endDate,
  holidayDates = new Set(),
  cholHamoedDates = new Set(),
  holidayDivisions = new Map(),
  holidays = [],
  holidayUsers = null,
  protectedDates = new Map(),
  priorJustice = new Map(),
  history = null,
  refine = true,
  spreadWeekdays = true,
  spreadWeekends = true,
  // Off by default: a day nobody can take under the one-shift-per-week rule is
  // reported as unassigned (the admin panel lists it) instead of silently giving
  // someone a second shift that week.
  allowWeeklyOverflow = false,
  // Randomized tie-breaking, so a rerun of the same range gives a different
  // (but equally fair) calendar. Pass a seed to reproduce a specific run.
  seed = null,
  // Rule (k): the week-spacing search and how many random moves it tries
  // (1.2 million: about 3 seconds for a year with 17 people).
  optimizeWeeks = true,
  weekIterations = 1200000,
  // Rule (c): chag shares offered first to whoever has the fewest chag days,
  // history carry included (within chagStrictBand days of the lowest).
  strictChagOrder = true,
  chagStrictBand = 1,
  // Rule (i): weekends staffed in date order, each to the person most overdue
  // for one in their own available time (weekendDue).
  weekendRotation = true,
  // random moves of the weekend-only search before weekdays are staffed
  weekendIterations = 200000,
  // how strongly the weekend-only search spreads heavy shifts evenly
  weekendEvenWeight = 30,
  // Rule (l): a person's own constraints cost their own spacing, in proportion.
  // gapAllowancePerWeek: one-week gaps allowed at a flat price per week of the
  // person's blocked days (blocked / 7). constraintWeightDays: the evenness of
  // short gaps counts 1 / (1 + blocked / constraintWeightDays), blocked days
  // scaled to a 365-day year. constraintsOwnCost: false treats everyone alike.
  constraintsOwnCost = true,
  constraintWeightDays = 25,
  gapAllowancePerWeek = 1,
}) {
  const holidayByDate = new Set(holidayDates);
  const divisionByDate = new Map(holidayDivisions);
  const breaksByDate = new Map();
  // Which manual holiday group (the admin list's group name) a chag day
  // belongs to — two different groups never merge into one block.
  const groupByDate = new Map();
  (holidays || []).forEach((holiday) => {
    if (!holiday?.start_date) return;
    const first = parseDateKey(holiday.start_date);
    const last = parseDateKey(holiday.end_date || holiday.start_date);
    if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return;
    for (const day = first; day <= last; day.setDate(day.getDate() + 1)) {
      const key = toDateKey(day);
      holidayByDate.add(key);
      groupByDate.set(key, String(holiday.name || ""));
      divisionByDate.set(key, Math.max(1, Number(holiday.divisions) || 1));
      const movedBreaks = (holiday.division_breaks || []).filter(Boolean);
      if (movedBreaks.length > 0) breaksByDate.set(key, movedBreaks);
    }
  });
  // Chol HaMoed days are holiday days too: a run of holiday days that are
  // straight next to each other is one block, divided into shares.
  const cholHamoedKeys = new Set(
    [...cholHamoedDates].map((k) => String(k).slice(0, 10)),
  );
  cholHamoedKeys.forEach((key) => holidayByDate.add(key));

  const holidayProtectedDates = holidayUsers?.protectedDates || new Map();
  const isProtected = (serialId, dateKey) =>
    !!protectedDates.get(serialId)?.has(dateKey) ||
    !!holidayProtectedDates.get(serialId)?.has(dateKey);
  const protectedOnDate = (dateKey) => {
    const ids = new Set();
    [protectedDates, holidayProtectedDates].forEach((table) =>
      table.forEach((dates, serialId) => {
        if (dates.has(dateKey)) ids.add(serialId);
      }),
    );
    return ids;
  };
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  const totalDays = differenceInCalendarDays(end, start) + 1;

  const inRangeShifts = (existingShifts || []).filter((s) => {
    if (!s.start_date) return false;
    return s.start_date >= startDate && s.start_date <= endDate;
  });

  // The per-group bookkeeping used for weekends, Thursdays and ordinary days.
  const groupFair = initState(people, inRangeShifts, priorJustice, holidayByDate);
  const runSeed = seed == null ? Math.floor(Math.random() * 2147483647) : seed;
  const runRng = makeRng(runSeed);
  groupFair.rng = runRng;

  // Holidays are divided between PEOPLE, not between group slots.
  const holidayPool = (holidayUsers?.people || []).filter(
    (p) => p?.serial_id != null,
  );
  const holidayByUser = holidayPool.length > 0;
  const holidayState = holidayByUser
    ? initState(
        holidayPool,
        (holidayUsers.existingShifts || existingShifts || []).filter(
          (s) => s?.start_date && s.start_date >= startDate && s.start_date <= endDate,
        ),
        new Map(),
        holidayByDate,
      )
    : null;
  const holidayGroupRepOf = holidayUsers?.groupRepOf || new Map();
  // Past shifts for chag fairness: holidayUsers.history, or the top-level
  // history when that's all that was passed. Without this fallback, chags in a
  // holidayUsers run would ignore who worked them last year.
  const holidayHistory = holidayUsers ? (holidayUsers.history ?? history) : null;
  // The slot in `people` that a holiday user's share uses up: their group
  // (groupRepOf), or the user themself when they are in `people` too (the
  // same people for chags and for everything else). Without it, a chag share
  // would not count toward that person's total, weekly slot or spacing while
  // weekends and weekdays are handed out.
  const peopleIdSet = new Set(people.map((p) => p.serial_id));
  const slotOf = (holidayUserId) =>
    holidayGroupRepOf.get(holidayUserId) ?? (peopleIdSet.has(holidayUserId) ? holidayUserId : null);
  // Chag shares can be swapped between people in the week search when every
  // holiday user is a person in `people` (no groups): a like-for-like swap
  // keeps each user's chag count.
  const holidayUsersArePeople =
    holidayPool.length > 0 &&
    holidayPool.every((p) => peopleIdSet.has(p.serial_id) && (holidayGroupRepOf.get(p.serial_id) ?? p.serial_id) === p.serial_id);

  const existingByDate = new Map();
  inRangeShifts.forEach((s) => existingByDate.set(s.start_date, s));

  const days = [];
  for (let i = 0; i < totalDays; i++) {
    const d = addDays(start, i);
    const key = toDateKey(d);
    const dow = d.getDay(); // 0=Sun..6=Sat
    const isWeekend = dow === 5 || dow === 6;
    const isHolidayDay = holidayByDate.has(key);
    let kind = "regular";
    if (isWeekend || isHolidayDay) kind = "together";
    days.push({
      date: d,
      key,
      weekKey: getWeekKey(d),
      kind,
      group: groupByDate.get(key) || null,
      existing: existingByDate.get(key) || null,
    });
  }

  // Rule (e)/(f) parameters, derived from the range itself.
  groupFair.idealGaps = computeIdealGaps(days, people.length, holidayByDate);
  groupFair.quota = days.length / Math.max(1, people.length);
  if (holidayState) {
    holidayState.idealGaps = computeIdealGaps(days, holidayPool.length, holidayByDate);
    // Holiday users share only the chag days, so they are held to the relative
    // band (rule e) without an absolute quota.
    holidayState.quota = null;
    holidayState.rng = runRng;
  }

  // Past shifts: seed fairness, spacing and the weekly cap from before the range.
  const groupOwners = applyHistory(
    groupFair,
    people,
    history,
    startDate,
    holidayByDate,
    (id) => holidayGroupRepOf.get(id),
  );
  const userOwners = holidayState
    ? applyHistory(holidayState, holidayPool, holidayHistory, startDate, holidayByDate)
    : null;
  // If the range starts in the middle of a Fri+Sat or chag block (e.g. a range
  // starting on a Saturday), the first block stays with whoever worked the day
  // before (rules b/c).
  const prevKey = toDateKey(addDays(start, -1));
  const prevDow = parseDateKey(prevKey).getDay();
  const prevTogether =
    prevDow === 5 || prevDow === 6 || holidayByDate.has(prevKey);
  const carryGroupId = prevTogether ? (groupOwners?.get(prevKey) ?? null) : null;
  const carryUserId = prevTogether ? (userOwners?.get(prevKey) ?? null) : null;

  // Group into bundles: consecutive days of the same kind chain into one bundle
  // — except "regular" days, which always stay their own bundle. A day that
  // belongs to a manual holiday group never joins a bundle that already holds a
  // DIFFERENT group, so each group is staffed as its own block.
  const bundles = [];
  let current = null;
  days.forEach((day) => {
    const nextToDay = current?.days[current.days.length - 1];
    const sameGroup =
      !nextToDay || !day.group || !current.holidayGroup || current.holidayGroup === day.group;
    if (day.kind !== "regular" && current?.kind === day.kind && sameGroup) {
      current.days.push(day);
      if (day.group && !current.holidayGroup) current.holidayGroup = day.group;
    } else {
      current = { kind: day.kind, days: [day], holidayGroup: day.group || null };
      bundles.push(current);
    }
  });

  // Dates that belong to a bundle holding a chag: staffed from the per-user
  // pool (see the holiday branch below), and needed again when the fairness
  // tables are rebuilt after spacing refinement.
  const holidayBundleKeys = new Set();
  bundles.forEach((bundle) => {
    if (bundle.days.some((d) => holidayByDate.has(d.key))) {
      bundle.days.forEach((d) => holidayBundleKeys.add(d.key));
    }
  });

  // Staffing order: chags, then weekends, then Thursdays, then ordinary days.
  const bundlePriority = (bundle) => {
    if (bundle.days.some((d) => holidayByDate.has(d.key))) return 0;
    if (bundle.kind === "together") return 1;
    if (bundle.days.every((d) => d.date.getDay() === 4)) return 2;
    return 3;
  };
  // Within the same priority, ordinary days that more people are blocked on go
  // first, while there is still a choice of who takes them.
  const pressure = (bundle) =>
    bundlePriority(bundle) >= 2
      ? Math.max(...bundle.days.map((d) => protectedOnDate(d.key).size))
      : 0;
  const orderedBundles = bundles
    .map((bundle) => ({
      bundle,
      prio: bundlePriority(bundle),
      load: pressure(bundle),
      // Equally urgent blocks are staffed in a random order per run, so a rerun
      // doesn't walk the calendar exactly the same way.
      jitter: runRng(),
    }))
    // Weekends are staffed in date order (rule i): each one goes to whoever is
    // most overdue for a weekend at that point of their available time.
    .sort(
      (a, b) =>
        a.prio - b.prio ||
        b.load - a.load ||
        (weekendRotation && a.prio === 1 ? (a.bundle.days[0].key < b.bundle.days[0].key ? -1 : 1) : 0) ||
        a.jitter - b.jitter,
    )
    .map((entry) => entry.bundle);

  // Rule (i), weekend rotation. Per person: their available days (not blocked
  // by their own constraints) as a prefix sum over the range, and the days of
  // heavy shifts (weekends, chag shares) they hold so far.
  const dayPos = new Map(days.map((d, i) => [d.key, i]));
  const freePrefixOf = new Map();
  const freePrefix = (id) => {
    if (!freePrefixOf.has(id)) {
      const pre = new Int32Array(days.length + 1);
      days.forEach((d, i) => { pre[i + 1] = pre[i] + (isProtected(id, d.key) ? 0 : 1); });
      freePrefixOf.set(id, pre);
    }
    return freePrefixOf.get(id);
  };
  const heavyDaysOf = new Map(); // person (slot in people) -> Set of day positions
  const plainWeekendCount = bundles.filter(
    (b) => b.kind === "together" && !b.days.some((d) => holidayByDate.has(d.key)) && b.days.some((d) => !d.existing),
  ).length;
  const weekendsEach = plainWeekendCount / Math.max(1, people.length);
  // How overdue person `id` is for a heavy shift at day position i: the heavy
  // shifts they "should" have had by now — their share of weekends plus their
  // own chag shares, spread over THEIR available days — minus what they have
  // (including a chag share or weekend coming up within half their ideal gap).
  const weekendDue = (id, i) => {
    const pre = freePrefix(id);
    const avail = pre[days.length];
    if (avail <= 0) return -Infinity;
    const held = heavyDaysOf.get(id) || new Set();
    const starts = [...held].filter((x) => !held.has(x - 1)).sort((x, y) => x - y);
    const chagRuns = starts.filter((x) => holidayByDate.has(days[x].key)).length;
    const expectedTotal = weekendsEach + chagRuns;
    const halfIdeal = days.length / Math.max(1, expectedTotal) / 2;
    const had = starts.filter((x) => x < i + halfIdeal).length;
    return (pre[i] / avail) * expectedTotal - had;
  };

  const assignments = [];
  const skipped = [];
  const relaxations = [];

  const firstBundle = bundles[0];

  // Shifts in the LOOKBACK days before the range (from history and from
  // existingShifts), per person. The passes below can't move them, but measure
  // every gap against them: when the range is planned on its own (a month at a
  // time), the first shifts of the range must not land right after the last
  // ones of the previous range.
  const lookbackDays = history?.lookbackDays ?? PAST_LOOKBACK_DAYS;
  const pastFrom = toDateKey(addDays(start, -lookbackDays));
  const peopleIds = new Set(people.map((p) => p.serial_id));
  const pastByDate = new Map();
  [...(history?.shifts || []), ...(existingShifts || [])].forEach((s) => {
    const key = s?.start_date ? String(s.start_date).slice(0, 10) : null;
    if (!key || key < pastFrom || key >= startDate) return;
    const id = peopleIds.has(s.original_user_id) ? s.original_user_id : holidayGroupRepOf.get(s.original_user_id);
    if (id == null || !peopleIds.has(id)) return;
    pastByDate.set(key, id);
  });
  const recentPast = [...pastByDate].map(([date, personId]) => ({ date, personId }));
  const recentPastShifts = recentPast.map((a) => ({ original_user_id: a.personId, start_date: a.date }));

  const togetherKeys = new Set(days.filter((d) => d.kind === "together").map((d) => d.key));
  const weekdayKeys = new Set(days.filter((d) => d.kind === "regular").map((d) => d.key));
  // A day before the range is a weekend/chag day by its weekday or chag date
  // (togetherKeys only covers the range), so a past Fri+Sat counts as one
  // weekend and as a heavy shift for the week rules.
  const isTogetherAny = (key) => {
    if (key >= startDate) return togetherKeys.has(key);
    const dow = parseDateKey(key).getDay();
    return dow === 5 || dow === 6 || holidayByDate.has(key);
  };

  const ownerOfRep = (id) => holidayGroupRepOf.get(id) ?? id;

  const staffBundle = (bundle) => {
    const anchorShift = bundle.days.find((d) => d.existing)?.existing;
    const anchorId = anchorShift?.original_user_id ?? null;

    const isHolidayBundle =
      bundle.kind === "together" && bundle.days.some((d) => holidayByDate.has(d.key));
    const holidayEmpty = isHolidayBundle ? bundle.days.filter((d) => !d.existing) : [];
    let holidayPartSizes = [];
    if (holidayEmpty.length > 0) {
      // The block is cut into pieces that are split on their own: runs of Chol
      // HaMoed days, and runs of the other days (erev, chag and the weekend
      // around them). A chag piece follows its Holiday record's חלוקות / moved
      // partitions; a Chol HaMoed piece gets two-day shares. Then a Friday and
      // its Saturday are kept in one share across all pieces.
      const pieces = [];
      holidayEmpty.forEach((d) => {
        const chm = cholHamoedKeys.has(d.key);
        const idx = dayIndex(d.date);
        const last = pieces[pieces.length - 1];
        if (last && last.chm === chm && idx - last.lastIdx === 1) last.days.push(d);
        else pieces.push({ chm, days: [d] });
        pieces[pieces.length - 1].lastIdx = idx;
      });
      const parts = pieces.flatMap((piece) => {
        const keys = piece.days.map((d) => d.key);
        const breaks = new Set();
        piece.days.forEach((d) => (breaksByDate.get(d.key) || []).forEach((b) => breaks.add(b)));
        if (piece.chm) return splitCholHamoed(keys);
        const divisions = Math.max(1, ...piece.days.map((d) => divisionByDate.get(d.key) || 1));
        return splitHolidayDays(keys, {
          divisions,
          breaks: [...breaks].filter((b) => keys.includes(b)),
        });
      });
      // The weekend merge runs first (a Friday keeps its Saturday), then every
      // share that grew past MAX_SHARE_DAYS is cut again — never between that
      // Friday and Saturday.
      holidayPartSizes = capShareLength(keepWeekendsTogether(parts)).map(
        (part) => part.length,
      );
    }
    let holidayPartIndex = 0;
    let holidayPartLeft = 0;
    let holidayPartPersonId = null;
    let holidayPartRelaxed = [];
    const holidayTried = new Set();

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

    segments.forEach((segment, segIndex) => {
      const emptyDays = segment.days.filter((d) => !d.existing);
      if (emptyDays.length === 0) return;
      const continuesPast =
        bundle === firstBundle &&
        bundle.kind === "together" &&
        segIndex === 0 &&
        emptyDays[0] === bundle.days[0];

      const anchorPerson =
        anchorId != null ? people.find((p) => p.serial_id === anchorId) : null;

      const togetherExcluded = new Set();
      emptyDays.forEach((d) => protectedOnDate(d.key).forEach((id) => togetherExcluded.add(id)));

      const useUserFairness =
        bundle.kind === "together" &&
        holidayByUser &&
        bundle.days.some((d) => holidayByDate.has(d.key));
      const fair = useUserFairness ? holidayState : groupFair;
      const fairPool = useUserFairness ? holidayPool : people;
      const assign = (personId, day, relaxed = []) => {
        assignments.push({ date: day.key, personId });
        if (relaxed.length > 0) relaxations.push({ date: day.key, personId, rules: relaxed });
        const category = categorizeDay(day.key, holidayByDate);
        recordAssignment(fair, personId, day.weekKey, day.date, category);
        if (day.kind === "together") {
          const slot = useUserFairness ? slotOf(personId) : personId;
          if (slot != null) {
            if (!heavyDaysOf.has(slot)) heavyDaysOf.set(slot, new Set());
            heavyDaysOf.get(slot).add(dayPos.get(day.key));
          }
        }
        // A holiday share also uses up the person's (or their group's) weekly
        // slot, total and spacing in the main bookkeeping.
        const slotId = useUserFairness ? slotOf(personId) : null;
        if (slotId != null) {
          recordAssignment(groupFair, slotId, day.weekKey, day.date, category);
        }
      };

      if (isHolidayBundle) {
        let day = 0;
        while (day < emptyDays.length) {
          if (holidayPartLeft <= 0) {
            holidayPartLeft = holidayPartSizes[holidayPartIndex] || 1;
            holidayPartIndex += 1;
            holidayPartPersonId = null;
          }

          const today = emptyDays[day];
          if (holidayPartPersonId == null) {
            // The share this person would take (the rest of it, if a constraint
            // cut the previous holder short).
            const shareDays = emptyDays.slice(day, day + Math.max(1, holidayPartLeft));
            // Prefer someone free for the WHOLE share, so a constraint doesn't
            // cut it and leave a lone day (such as the Saturday) to someone
            // else; fall back to anyone free on its first day.
            const excluded = new Set(holidayTried);
            shareDays.forEach((d) => protectedOnDate(d.key).forEach((id) => excluded.add(id)));
            const firstDayExcluded = new Set(holidayTried);
            protectedOnDate(today.key).forEach((id) => firstDayExcluded.add(id));
            // Spacing is measured over the whole share this person would take.
            const shareIdxs = shareDays.map((d) => dayIndex(d.date));
            const anchorFits =
              holidayTried.size === 0 && anchorPerson && !firstDayExcluded.has(anchorPerson.serial_id);
            const carryId = useUserFairness ? carryUserId : carryGroupId;
            const carryPerson =
              continuesPast &&
              day === 0 &&
              holidayTried.size === 0 &&
              carryId != null &&
              !firstDayExcluded.has(carryId)
                ? fairPool.find((p) => p.serial_id === carryId)
                : null;
            let pick = anchorFits
              ? { person: anchorPerson, relaxed: [] }
              : carryPerson
                ? { person: carryPerson, relaxed: [] }
                : null;
            // Chags go strictly by count (rule c): the share is offered first
            // to the people free for it with the fewest chag days INCLUDING
            // their history carry (within chagStrictBand days of the lowest);
            // spacing and the other checks then choose among them. Only if
            // none of them fits is everyone free for it considered.
            const pickChag = (excludedIds) => {
              if (strictChagOrder) {
                // the people free for the share and still free that Sun–Sat
                // week (rule a), and of those the ones with the fewest chag
                // days including their history carry
                const count = (id) => (fair.cats.get(id)?.holidays || 0) + (fair.kindSeed.get(id)?.holidays || 0);
                const free = fairPool.filter(
                  (p) => !excludedIds.has(p.serial_id) && remainingCapacity(fair.weekly, p.serial_id, today.weekKey) > 0,
                );
                if (free.length > 0) {
                  const lowest = Math.min(...free.map((p) => count(p.serial_id)));
                  const owed = free.filter((p) => count(p.serial_id) < lowest + chagStrictBand);
                  const strict = pickTogetherCandidate(fair, owed, today.weekKey, excludedIds, "holidays", shareIdxs);
                  if (strict) return strict;
                }
              }
              return pickTogetherCandidate(fair, fairPool, today.weekKey, excludedIds, "holidays", shareIdxs);
            };
            if (!pick) pick = pickChag(excluded);
            if (!pick) pick = pickChag(firstDayExcluded);
            if (!pick && holidayTried.size > 0) pick = pickChag(protectedOnDate(today.key));
            if (!pick) {
              emptyDays.slice(day).forEach((d) =>
                skipped.push({ date: d.key, reason: "לא אותר אדם זמין לחלוקת החג" }),
              );
              break;
            }
            holidayPartPersonId = pick.person.serial_id;
            holidayPartRelaxed = pick.relaxed;
            holidayTried.add(pick.person.serial_id);
          }

          if (isProtected(holidayPartPersonId, today.key)) {
            holidayPartPersonId = null;
            continue;
          }

          assign(holidayPartPersonId, today, holidayPartRelaxed);
          holidayPartLeft -= 1;
          if (holidayPartLeft === 0) holidayPartPersonId = null;
          day += 1;
        }
        return;
      }

      if (bundle.kind === "together") {
        const carryPerson =
          continuesPast && carryGroupId != null && !togetherExcluded.has(carryGroupId)
            ? people.find((p) => p.serial_id === carryGroupId)
            : null;
        // Rule (i): among the people free for this weekend, offer it first to
        // the most overdue (weekendDue); the usual fairness band and spacing
        // tiers then choose among them. Anyone else only if none of them fits.
        const idxs = emptyDays.map((d) => dayIndex(d.date));
        let pick = anchorPerson
          ? { person: anchorPerson, relaxed: [] }
          : carryPerson
            ? { person: carryPerson, relaxed: [] }
            : null;
        if (!pick && weekendRotation) {
          const at = dayPos.get(emptyDays[0].key);
          const free = fairPool.filter((p) => !togetherExcluded.has(p.serial_id));
          const dues = free.map((p) => ({ p, due: weekendDue(p.serial_id, at) }));
          const top = Math.max(...dues.map((x) => x.due));
          const overdue = dues.filter((x) => x.due >= top - 0.5).map((x) => x.p);
          if (overdue.length) pick = pickTogetherCandidate(fair, overdue, segment.weekKey, togetherExcluded, "weekends", idxs);
        }
        if (!pick) pick = pickTogetherCandidate(fair, fairPool, segment.weekKey, togetherExcluded, "weekends", idxs);

        if (!pick) {
          emptyDays.forEach((d) => skipped.push({ date: d.key, reason: "לא אותר אדם זמין בכלל" }));
          return;
        }

        emptyDays.forEach((d) => assign(pick.person.serial_id, d, pick.relaxed));
        return;
      }

      // Ordinary day: strict weekly cap applies.
      let remaining = emptyDays;
      const tried = new Set();
      while (remaining.length > 0) {
        const anchorDay = remaining[0];
        const excludeIds = new Set(tried);
        protectedOnDate(anchorDay.key).forEach((id) => excludeIds.add(id));

        const anchorUsable =
          anchorPerson &&
          !excludeIds.has(anchorPerson.serial_id) &&
          remainingCapacity(groupFair.weekly, anchorPerson.serial_id, segment.weekKey) >= 1;

        const pick = anchorUsable
          ? { person: anchorPerson, relaxed: [] }
          : pickCandidate(
              groupFair,
              people,
              segment.weekKey,
              1,
              excludeIds,
              categorizeDay(anchorDay.key, holidayByDate),
              [dayIndex(anchorDay.date)],
            );

        if (!pick) break;
        const chosen = pick.person;

        const capacity = remainingCapacity(groupFair.weekly, chosen.serial_id, segment.weekKey);
        let take = Math.min(capacity, remaining.length);
        for (let i = 0; i < take; i++) {
          if (isProtected(chosen.serial_id, remaining[i].key)) {
            take = i;
            break;
          }
        }
        const toAssign = remaining.slice(0, take);
        toAssign.forEach((d) => {
          assignments.push({ date: d.key, personId: chosen.serial_id });
          if (pick.relaxed.length > 0) {
            relaxations.push({ date: d.key, personId: chosen.serial_id, rules: pick.relaxed });
          }
          recordAssignment(
            groupFair,
            chosen.serial_id,
            segment.weekKey,
            d.date,
            categorizeDay(d.key, holidayByDate),
          );
        });
        remaining = remaining.slice(take);
        tried.add(chosen.serial_id);
      }
      remaining.forEach((d) =>
        skipped.push({ date: d.key, reason: "לא אותר אדם זמין עם מכסה שבועית פנויה" }),
      );
    });
  };

  // Chags and weekends first, then — before any weekday is handed out — the
  // weekends alone are spread evenly over each person's available time (rule
  // i): whole weekends are swapped between people while nothing else is in the
  // way, chag shares and saved shifts stay put. Then the fairness bookkeeping
  // is rebuilt from the result and Thursdays and ordinary days are staffed
  // around the weekends.
  const heavyBundles = orderedBundles.filter((b) => bundlePriority(b) <= 1);
  const weekdayBundles = orderedBundles.filter((b) => bundlePriority(b) > 1);
  heavyBundles.forEach(staffBundle);
  let earlyWeekends = null;
  if (weekendRotation && optimizeWeeks && assignments.length > 0) {
    earlyWeekends = optimizeDistribution(assignments, {
      isTogether: isTogetherAny,
      holidayKeys: holidayByDate,
      lockedDates: new Set([
        ...inRangeShifts.map((s) => String(s.start_date).slice(0, 10)),
        ...holidayBundleKeys,
      ]),
      ownerOf: ownerOfRep,
      isProtected,
      startDate,
      endDate,
      fixedBefore: recentPast,
      seed: runSeed + 1,
      iterations: weekendIterations,
      swapChagShares: false,
      heavyEvenWeight: weekendEvenWeight,
    });
    if (earlyWeekends.stats.swaps > 0) {
      const moved = earlyWeekends.stats.moved;
      assignments.length = 0;
      earlyWeekends.assignments.forEach((a) => assignments.push(a));
      for (let r = relaxations.length - 1; r >= 0; r--) if (moved.has(relaxations[r].date)) relaxations.splice(r, 1);
      // rebuild the main bookkeeping from what is handed out now
      const fresh = initState(
        people,
        inRangeShifts.concat(assignments.map((a) => ({ original_user_id: slotOf(a.personId) ?? a.personId, start_date: a.date }))),
        priorJustice,
        holidayByDate,
      );
      fresh.rng = runRng;
      fresh.idealGaps = groupFair.idealGaps;
      fresh.quota = groupFair.quota;
      applyHistory(fresh, people, history, startDate, holidayByDate, (id) => holidayGroupRepOf.get(id));
      Object.assign(groupFair, fresh);
    }
  }
  weekdayBundles.forEach(staffBundle);

  // Last resort for a day that nobody could take under the normal rules —
  // rather than leave it empty, it is given fairly:
  //   - a Thursday or ordinary day nobody is free for under the
  //     one-shift-per-week rule (rule a) → a second shift that week;
  //   - a weekend (or chag) block nobody is free for on ALL its days → its days
  //     are given one by one, so Friday and Saturday can go to two people.
  // Among the people without a constraint on that day, only those within
  // MAX_TOTAL_SPREAD of the fewest shifts are considered (rule e); of those, the
  // day goes to the one whose nearest shift is furthest from it.
  const lastResortDates = new Set();
  if (allowWeeklyOverflow) {
    const dayByKey = new Map(days.map((d) => [d.key, d]));
    const stillSkipped = [];
    skipped
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .forEach((entry) => {
        const day = dayByKey.get(entry.date);
        if (!day) {
          stillSkipped.push(entry);
          return;
        }
        const userPool = holidayByUser && holidayBundleKeys.has(day.key);
        const fair = userPool ? holidayState : groupFair;
        const pool = userPool ? holidayPool : people;
        const idx = dayIndex(day.date);
        const rows = pool
          .filter((p) => !isProtected(p.serial_id, day.key))
          .map((p) => ({
            person: p,
            near: nearestGap(fair, p.serial_id, [idx], "any"),
            count: fair.justice.get(p.serial_id) || 0,
            load: fair.cats.get(p.serial_id)?.load || 0,
          }));
        if (rows.length === 0) {
          stillSkipped.push(entry);
          return;
        }
        const fewest = Math.min(...rows.map((r) => r.count));
        const band = rows.filter((r) => r.count <= fewest + MAX_TOTAL_SPREAD);
        band.sort(
          (a, b) =>
            (b.near > a.near ? 1 : b.near < a.near ? -1 : 0) ||
            a.count - b.count ||
            a.load - b.load ||
            (a.person.full_name || "").localeCompare(b.person.full_name || ""),
        );
        const chosen = band[0].person;
        const rules = [];
        if (remainingCapacity(fair.weekly, chosen.serial_id, day.weekKey) <= 0)
          rules.push("weekly_cap");
        if (day.kind === "together") rules.push("split_block");
        lastResortDates.add(day.key);
        assignments.push({ date: day.key, personId: chosen.serial_id });
        relaxations.push({ date: day.key, personId: chosen.serial_id, rules });
        const category = categorizeDay(day.key, holidayByDate);
        recordAssignment(fair, chosen.serial_id, day.weekKey, day.date, category);
        const slotId = userPool ? slotOf(chosen.serial_id) : null;
        if (slotId != null) {
          recordAssignment(groupFair, slotId, day.weekKey, day.date, category);
        }
      });
    skipped.length = 0;
    stillSkipped.forEach((entry) => skipped.push(entry));
  }

  // Spacing refinement: the greedy pass decides day by day, with spacing only
  // as a soft tiebreaker, so its result is kept as the seed and the blocks are
  // moved/swapped a few times to even out the gaps per kind. It runs BEFORE the
  // spreading passes and the week-spacing search (rule k): it evens out gaps
  // per kind only and knows nothing of weeks or of whose constraints are
  // whose, so run last it could undo the search, e.g. a weekday in one week
  // and a weekend in the next for someone without constraints.
  const refined = refine
    ? refineSpacing(assignments, {
        bundles,
        people,
        holidayPool,
        holidayByDate,
        protectedDates,
        holidayProtectedDates,
        startDate,
        endDate,
      })
    : null;
  const refinedAssignments = refined ? refined.assignments : assignments;

  // Thursdays and ordinary days: swap same-kind shifts between people while it
  // spreads everyone's shifts further apart (counts per kind don't change).
  // Weekends first: swap whole Fri+Sat blocks so each person's heavy shifts
  // (weekends + chag shares) are spread evenly and as far apart as possible.
  const plainWeekends = bundles
    .filter((b) => b.kind === "together" && !b.days.some((d) => holidayByDate.has(d.key) || d.existing))
    .filter((b) => b.days.length === 2 && b.days[0].date.getDay() === 5 && b.days[1].date.getDay() === 6)
    .filter((b) => !b.days.some((d) => lastResortDates.has(d.key)))
    .map((b) => ({ keys: b.days.map((d) => d.key) }));
  const weekendSpread = spreadWeekends && !earlyWeekends
    ? spreadWeekendShifts(refinedAssignments, {
        weekends: plainWeekends,
        isHeavy: (key) => togetherKeys.has(key) || (key < startDate && isTogetherAny(key)),
        startDate,
        endDate,
        ownerOf: (id) => holidayGroupRepOf.get(id) ?? id,
        isProtected,
        fixedShifts: inRangeShifts.concat(recentPastShifts),
      })
    : null;
  const afterWeekends = weekendSpread ? weekendSpread.assignments : refinedAssignments;

  const spread = spreadWeekdays
    ? spreadWeekdayShifts(afterWeekends, {
        isWeekday: (key) => weekdayKeys.has(key),
        isTogether: (key) => togetherKeys.has(key),
        ownerOf: (id) => holidayGroupRepOf.get(id) ?? id,
        isProtected,
        fixedShifts: inRangeShifts.concat(recentPastShifts),
      })
    : null;
  const spreadAssignments = spread ? spread.assignments : afterWeekends;

  // Rule (k): week spacing. Swap same-kind units between people so nobody works
  // back-to-back weeks or with a single empty week between shifts, as far as
  // the calendar allows. Existing shifts and last-resort days stay put.
  const weekCtx = {
    isTogether: isTogetherAny,
    holidayKeys: holidayByDate,
    lockedDates: new Set([...inRangeShifts.map((s) => String(s.start_date).slice(0, 10)), ...lastResortDates]),
    ownerOf: ownerOfRep,
    isProtected,
    startDate,
    endDate,
    fixedBefore: recentPast,
  };
  const weekBefore = spacingScore(spreadAssignments, weekCtx);
  // Rule (k): blocked days per person in the range, and the weight that keeps
  // the cost of someone's constraints on their own calendar.
  const blockedDays = new Map();
  people.forEach((p) => {
    let n = 0;
    for (let d = parseDateKey(startDate); toDateKey(d) <= endDate; d = addDays(d, 1)) if (isProtected(p.serial_id, toDateKey(d))) n += 1;
    blockedDays.set(p.serial_id, n);
  });
  // Blocked days are taken as a share of the range and scaled to a year, so a
  // month planned on its own weighs constraints as strongly as a whole year:
  // 20 blocked days out of a 30-day month count like ~240 out of a year.
  const constraintWeight = (owner) =>
    1 / (1 + ((blockedDays.get(owner) || 0) / Math.max(1, totalDays)) * (365 / constraintWeightDays));
  const weekOpt = optimizeWeeks
    ? optimizeDistribution(spreadAssignments, {
        ...weekCtx,
        seed: runSeed,
        iterations: weekIterations,
        // chag shares belong to individual users when holidayUsers is given;
        // they can still be swapped when those users are the same people
        swapChagShares: !holidayByUser || holidayUsersArePeople,
        weightOf: constraintsOwnCost ? constraintWeight : () => 1,
        gapAllowance: constraintsOwnCost,
        allowancePerWeek: gapAllowancePerWeek,
      })
    : null;
  const weekAssignments = weekOpt ? weekOpt.assignments : spreadAssignments;

  // A relaxation recorded for a day that has since changed hands no longer
  // describes who works it, so it is dropped.
  const movedDays = new Set([
    ...(weekendSpread ? weekendSpread.stats.moved : []),
    ...(spread ? spread.stats.moved : []),
    ...(weekOpt ? weekOpt.stats.moved : []),
  ]);
  const keptRelaxations = relaxations.filter((r) => !movedDays.has(r.date));

  const finalAssignments = weekAssignments;

  // Rebuild the fairness tables from what was actually handed out, so they
  // describe the refined calendar rather than the greedy one. The history seed
  // is re-applied on top, exactly as before.
  const repOf = (id) => holidayGroupRepOf.get(id) ?? id;
  const finalGroupFair = initState(
    people,
    inRangeShifts.concat(
      finalAssignments.map((a) => ({ original_user_id: repOf(a.personId), start_date: a.date })),
    ),
    priorJustice,
    holidayByDate,
  );
  applyHistory(finalGroupFair, people, history, startDate, holidayByDate, (id) =>
    holidayGroupRepOf.get(id),
  );
  const finalHolidayState = holidayState
    ? initState(
        holidayPool,
        (holidayUsers.existingShifts || existingShifts || [])
          .filter((s) => s?.start_date && s.start_date >= startDate && s.start_date <= endDate)
          .concat(
            finalAssignments
              .filter((a) => holidayBundleKeys.has(a.date))
              .map((a) => ({ original_user_id: a.personId, start_date: a.date })),
          ),
        new Map(),
        holidayByDate,
      )
    : null;
  if (finalHolidayState) {
    applyHistory(finalHolidayState, holidayPool, holidayHistory, startDate, holidayByDate);
  }

  const round2 = (x) => Math.round(x * 100) / 100;
  const table = (fair, pool, prior) =>
    pool
      .map((p) => {
        const id = p.serial_id;
        const c = fair.cats.get(id) || emptyCats();
        const range = fair.rangeCount.get(id) || 0;
        const past = fair.pastRaw.get(id) || 0;
        return {
          personId: id,
          name: p.full_name,
          totalShifts: (prior.get(id) || 0) + past + range,
          pastShifts: past,
          rangeShifts: range,
          balance: round2(fair.justice.get(id) || 0),
          holidays: round2(c.holidays),
          holidayCarry: round2(fair.kindSeed.get(id)?.holidays || 0),
          weekends: round2(c.weekends),
          thursdays: round2(c.thursdays),
          regular: round2(c.regular),
          load: round2(c.load),
        };
      })
      .sort((a, b) => a.balance - b.balance);

  return {
    assignments: finalAssignments,
    skipped,
    relaxations: keptRelaxations,
    justiceTable: table(finalGroupFair, people, priorJustice),
    holidayTable: finalHolidayState ? table(finalHolidayState, holidayPool, new Map()) : null,
    spacing: refined ? refined.stats : null,
    // Days that would have stayed empty and were filled by the last resort.
    weeklyOverflow: finalAssignments
      .filter((a) => lastResortDates.has(a.date))
      .map((a) => ({ date: a.date, personId: a.personId })),
    weekendSpread: weekendSpread
      ? {
          passes: weekendSpread.stats.passes,
          swaps: weekendSpread.stats.swaps,
          movedWeekends: weekendSpread.stats.moved.size / 2,
          costBefore: weekendSpread.stats.costBefore,
          costAfter: weekendSpread.stats.costAfter,
        }
      : null,
    // Rule (k): week-spacing numbers before and after the search, including the
    // gaps to the shifts just before the range.
    weekSpacing: (() => {
      const after = spacingScore(finalAssignments, weekCtx);
      const strip = ({ perPerson, ...rest }) => rest;
      return {
        before: strip(weekBefore),
        after: strip(after),
        perPerson: after.perPerson,
        swaps: weekOpt ? weekOpt.stats.swaps : 0,
        iterations: optimizeWeeks ? weekIterations : 0,
      };
    })(),
    weekdaySpread: spread
      ? {
          passes: spread.stats.passes,
          swaps: spread.stats.swaps,
          movedDays: spread.stats.moved.size,
          costBefore: spread.stats.costBefore,
          costAfter: spread.stats.costAfter,
        }
      : null,
  };
}