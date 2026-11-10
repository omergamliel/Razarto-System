import { addDays, differenceInCalendarDays, format, startOfWeek } from "date-fns";
import {
  MAX_SHARE_DAYS,
  capShareLength,
  keepWeekendsTogether,
  splitCholHamoed,
  splitHolidayDays,
} from "@/lib/holidayDivisions";
import { refineSpacing } from "@/components/calendar/spacingRefinement";

// No one may be assigned more than this many shifts within a single
// (Sunday-Saturday) calendar week — rule (a). A togetherness block (Fri+Sat, or
// a chag + its erev — rules b/c) is the deliberate exception: it still goes to
// one person as a single unit even though it spans two days of the same week.
const WEEKLY_CAP = 1;

// Rule (e) — total-shifts regulation. When a slot is filled, candidates whose
// total is more than MAX_TOTAL_SPREAD above the lowest are held back, and so is
// anyone who already reached their quota for the range
// (ceil(days in range / people)). Both are relaxed only when nobody inside them
// can take the slot.
const MAX_TOTAL_SPREAD = 1;

// Rule (f) — spacing regulation per kind of day: a candidate closer than
// SPACING_TOLERANCE of the ideal gap of that kind is held back while someone
// better spaced is available.
const SPACING_TOLERANCE = 0.6;
// Rule (d): two shifts closer than this (i.e. calendar-adjacent) are never
// "comfortable".
const MIN_GAP_ANY = 2;

// Past shifts: shifts this many days before the range start still count for
// spacing and the weekly cap, so whoever worked on 31 Dec isn't handed 1 Jan.
const DEFAULT_LOOKBACK_DAYS = 42;

// Thursdays and ordinary days are spread after the greedy pass by swapping
// same-kind shifts (spreadWeekdayShifts). A gap of g days costs g^-POWER.
const WEEKDAY_GAP_POWER = 3;
const WEEKDAY_SPREAD_MAX_PASSES = 40;

// Weekends: whole Fri+Sat blocks are swapped so each person's HEAVY shifts —
// weekends and chag shares together — are spread evenly over the range.
const WEEKEND_GAP_POWER = 3;
const WEEKEND_SPREAD_MAX_PASSES = 40;
const DAY_CATEGORIES = ["holidays", "weekends", "thursdays", "regular"];

// Which spacing groups a newly assigned day is measured against.
// "hard" = chags and weekends together; "any" = every shift.
const SPACING_GROUPS = {
  holidays: ["holidays", "hard", "any"],
  weekends: ["weekends", "hard", "any"],
  thursdays: ["thursdays", "any"],
  regular: ["any"],
};

const inSpacingGroup = (group, category) =>
  group === "any" ||
  group === category ||
  (group === "hard" && (category === "holidays" || category === "weekends"));

const toDateKey = (date) => format(date, "yyyy-MM-dd");

// Parses 'yyyy-MM-dd' (or an ISO string starting with it) as LOCAL midnight, so
// the weekday and week key never shift by a day across time zones.
const parseDateKey = (key) => new Date(`${String(key).slice(0, 10)}T00:00:00`);

// A whole-day index (DST-safe) for fast gap arithmetic.
const dayIndex = (date) =>
  Math.round(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000,
  );

// Sunday-based week key, matching the week boundaries used elsewhere in the app.
const getWeekKey = (date) => toDateKey(startOfWeek(date, { weekStartsOn: 0 }));

// How heavy each kind of day is for the person working it, so fairness is
// measured on weighted effort and not on a plain day count.
const CATEGORY_WEIGHT = { holidays: 3, weekends: 2.5, thursdays: 1.5, regular: 1 };

// The fairness category of a day — a chag day wins over its weekday.
const categorizeDay = (dateKey, holidayByDate) => {
  const key = String(dateKey).slice(0, 10);
  if (holidayByDate.has(key)) return "holidays";
  const dow = parseDateKey(key).getDay();
  if (dow === 5 || dow === 6) return "weekends";
  if (dow === 4) return "thursdays";
  return "regular";
};

const emptyCats = () => ({
  holidays: 0,
  weekends: 0,
  thursdays: 0,
  regular: 0,
  load: 0,
});

const bumpCats = (cats, personId, category) => {
  const c = cats.get(personId);
  if (!c) return;
  c[category] += 1;
  c.load += CATEGORY_WEIGHT[category];
};

// Records one assigned day in a fairness state: the justice count (which may
// include prior history), the in-range count (used for the quota), the
// per-day-type tallies, the per-week count and the dated list used for spacing.
function recordAssignment(fair, personId, weekKey, date, category) {
  fair.justice.set(personId, (fair.justice.get(personId) || 0) + 1);
  fair.rangeCount.set(personId, (fair.rangeCount.get(personId) || 0) + 1);
  if (!fair.cats.has(personId)) fair.cats.set(personId, emptyCats());
  bumpCats(fair.cats, personId, category);
  const perWeek = fair.weekly.get(personId) || new Map();
  perWeek.set(weekKey, (perWeek.get(weekKey) || 0) + 1);
  fair.weekly.set(personId, perWeek);
  const list = fair.assigned.get(personId) || [];
  list.push({ day: dayIndex(date), category });
  fair.assigned.set(personId, list);
}

// Seeds the fairness ("justice") table, the per-day-type tallies, the per-week
// counts and every day each person already holds — all from shifts INSIDE
// [startDate, endDate] only. Only the justice count is seeded with history
// (`priorJustice`); quota, weekly cap and spacing are about this range.
function initState(
  people,
  inRangeShifts,
  priorJustice = new Map(),
  holidayByDate = new Set(),
) {
  const fair = {
    justice: new Map(),
    rangeCount: new Map(),
    cats: new Map(),
    weekly: new Map(),
    // personId -> [{ day, category }] — every assigned day, not just the latest,
    // because bundles are staffed out of calendar order.
    assigned: new Map(),
    idealGaps: null,
    quota: null,
  };
  people.forEach((p) => {
    fair.justice.set(p.serial_id, priorJustice.get(p.serial_id) || 0);
    fair.rangeCount.set(p.serial_id, 0);
    fair.cats.set(p.serial_id, emptyCats());
    fair.weekly.set(p.serial_id, new Map());
    fair.assigned.set(p.serial_id, []);
  });

  inRangeShifts.forEach((s) => {
    const personId = s.original_user_id;
    if (!fair.justice.has(personId)) return; // not an eligible/tracked person
    const d = parseDateKey(s.start_date);
    if (Number.isNaN(d.getTime())) return;
    recordAssignment(
      fair,
      personId,
      getWeekKey(d),
      d,
      categorizeDay(s.start_date, holidayByDate),
    );
  });

  fair.pastRaw = new Map();
  fair.quotaAdj = new Map();
  // Per-kind carry-over from history that counts ONLY in the fairness of that
  // kind: personId -> { holidays: x, ... }.
  fair.kindSeed = new Map();
  return fair;
}

/**
 * Seeds a fairness state with shifts from BEFORE the range (the `history`
 * option).
 *
 * mode "normalized" (default): each person is seeded with how far they are
 * above or below their fair share of the past, per kind of day. Someone who
 * joined yesterday starts at 0, neither owing nor owed.
 * mode "raw": each person is seeded with their plain past counts.
 *
 * history.fairnessKinds:
 *   - ["holidays"] (default): only chag fairness carries over.
 *   - "all": every kind, the total, the load and the quota carry over.
 *
 * Shifts within `lookbackDays` of the start are also recorded for spacing and
 * the weekly cap, whatever fairnessKinds says.
 *
 * Returns the owner of each past date (used to carry a Fri+Sat or chag block
 * that the range start cuts in half), or null when there's no history.
 */
function applyHistory(
  fair,
  pool,
  history,
  startDate,
  holidayByDate,
  resolveId = () => null,
) {
  if (!history || !Array.isArray(history.shifts) || history.shifts.length === 0)
    return null;
  const mode = history.mode === "raw" ? "raw" : "normalized";
  const fairnessKinds = history.fairnessKinds ?? ["holidays"];
  const allKinds = fairnessKinds === "all";
  const lookback = history.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const startIdx = dayIndex(parseDateKey(startDate));
  const ids = new Set(pool.map((p) => p.serial_id));
  const pastCats = new Map(pool.map((p) => [p.serial_id, emptyCats()]));
  const fromKey = history.from ? String(history.from).slice(0, 10) : null;
  // All past work per kind, including shifts by people who have since left —
  // that work sets the fair rate even though they no longer take part.
  const doneAll = emptyCats();
  const owners = new Map();
  let firstIdx = Infinity;

  history.shifts.forEach((s) => {
    if (!s?.start_date) return;
    const key = String(s.start_date).slice(0, 10);
    if (key >= startDate || (fromKey && key < fromKey)) return;
    const d = parseDateKey(key);
    if (Number.isNaN(d.getTime())) return;
    const idx = dayIndex(d);
    const category = categorizeDay(key, holidayByDate);
    firstIdx = Math.min(firstIdx, idx);
    doneAll[category] += 1;
    const id = ids.has(s.original_user_id)
      ? s.original_user_id
      : resolveId(s.original_user_id);
    if (!ids.has(id)) return;
    bumpCats(pastCats, id, category);
    owners.set(key, id);
    if (startIdx - idx <= lookback) {
      fair.assigned.get(id).push({ day: idx, category });
      const perWeek = fair.weekly.get(id);
      const wk = getWeekKey(d);
      perWeek.set(wk, (perWeek.get(wk) || 0) + 1);
    }
  });
  if (firstIdx === Infinity) return null;

  const fromIdx = history.from ? dayIndex(parseDateKey(history.from)) : firstIdx;
  const activeDays = (id) => {
    const joined = history.activeFrom?.get(id);
    const from = joined ? Math.max(fromIdx, dayIndex(parseDateKey(joined))) : fromIdx;
    return Math.max(0, startIdx - from);
  };
  // Fair rate per active person-day: all past work of that kind divided by the
  // headcount that shared it (the current pool size unless `headcount` says
  // otherwise — with turnover the seats are usually refilled one for one).
  const windowDays = Math.max(1, startIdx - fromIdx);
  const headcount = Math.max(1, history.headcount ?? pool.length);
  const rate = {};
  DAY_CATEGORIES.forEach((cat) => {
    rate[cat] = doneAll[cat] / (headcount * windowDays);
  });

  pool.forEach((p) => {
    const id = p.serial_id;
    const past = pastCats.get(id);
    const days = activeDays(id);
    const cats = fair.cats.get(id);
    let seedTotal = 0;
    let rawTotal = 0;
    const kindSeed = {};
    DAY_CATEGORIES.forEach((cat) => {
      const seed = mode === "raw" ? past[cat] : past[cat] - rate[cat] * days;
      rawTotal += past[cat];
      if (allKinds) {
        cats[cat] += seed;
        cats.load += CATEGORY_WEIGHT[cat] * seed;
        seedTotal += seed;
      } else if (fairnessKinds.includes(cat)) {
        // counts only when that kind of day is handed out (kindCount)
        kindSeed[cat] = seed;
      }
    });
    fair.pastRaw.set(id, rawTotal);
    fair.kindSeed.set(id, kindSeed);
    if (allKinds) {
      fair.justice.set(id, (fair.justice.get(id) || 0) + seedTotal);
      // Someone owed shifts may go above the plain quota to catch up, and
      // someone ahead stops earlier.
      if (mode === "normalized") fair.quotaAdj.set(id, seedTotal);
    }
  });
  return owners;
}

// Ideal per-person gap (in days) for each spacing group, for a pool of
// `poolSize` people sharing the range. Occasions are counted in assignment
// units: a weekend is one Fri+Sat block, a chag share is ~2 days.
function computeIdealGaps(days, poolSize, holidayByDate) {
  const totalDays = Math.max(1, days.length);
  const P = Math.max(1, poolSize);
  let holidayDays = 0;
  let thursdays = 0;
  let regular = 0;
  const weekendWeeks = new Set();
  days.forEach((d) => {
    const category = categorizeDay(d.key, holidayByDate);
    if (category === "holidays") holidayDays += 1;
    else if (category === "weekends") weekendWeeks.add(d.weekKey);
    else if (category === "thursdays") thursdays += 1;
    else regular += 1;
  });
  const occasions = {
    holidays: Math.ceil(holidayDays / 2),
    weekends: weekendWeeks.size,
    thursdays,
  };
  occasions.hard = occasions.holidays + occasions.weekends;
  occasions.any = occasions.hard + thursdays + regular;

  const ideal = {};
  Object.entries(occasions).forEach(([group, n]) => {
    ideal[group] = n > 0 ? Math.min(totalDays, (totalDays * P) / n) : totalDays;
  });
  return ideal;
}

const minGapFor = (group, ideal) => {
  const gap = Math.floor(ideal * SPACING_TOLERANCE);
  return group === "any" ? Math.max(MIN_GAP_ANY, gap) : gap;
};

// Distance in days from any of `dayIdxs` to the nearest day this person
// already holds within the given spacing group.
const nearestGap = (fair, personId, dayIdxs, group) => {
  const list = fair.assigned.get(personId);
  if (!list || list.length === 0) return Infinity;
  let best = Infinity;
  for (const a of list) {
    if (!inSpacingGroup(group, a.category)) continue;
    for (const idx of dayIdxs) {
      const gap = Math.abs(a.day - idx);
      if (gap < best) best = gap;
    }
  }
  return best;
};

// How well a candidate is spaced for this kind of day:
//   adjacent — would land calendar-adjacent to another of their shifts (rule d)
//   spaced   — meets the minimum gap of every relevant group (rule f)
//   penalty  — 0 when every gap is at least ideal, growing as gaps shrink.
function spacingFor(fair, personId, dayIdxs, category) {
  let penalty = 0;
  let spaced = true;
  let adjacent = false;
  if (!dayIdxs || !fair.idealGaps) return { penalty, spaced, adjacent };
  (SPACING_GROUPS[category] || SPACING_GROUPS.regular).forEach((group) => {
    const ideal = fair.idealGaps[group];
    const gap = nearestGap(fair, personId, dayIdxs, group);
    if (gap === Infinity) return;
    if (group === "any" && gap < MIN_GAP_ANY) adjacent = true;
    if (gap < minGapFor(group, ideal)) spaced = false;
    penalty += Math.max(0, 1 - gap / ideal);
  });
  return { penalty, spaced, adjacent };
}

const remainingCapacity = (weekly, personId, weekKey) =>
  WEEKLY_CAP - (weekly.get(personId)?.get(weekKey) || 0);

// The count that must stay balanced for the kind of block being handed out.
// A per-kind history carry-over (kindSeed) is added here only, so it weighs in
// the fairness of that kind and nowhere else.
const kindCount = (row, kind) => {
  const seed = row.kindSeed?.[kind] || 0;
  if (kind === "holidays") return row.cats.holidays + seed;
  if (kind === "weekends") return row.cats.weekends + seed;
  if (kind === "thursdays") return row.cats.thursdays + seed;
  return row.count;
};

// Fairest first: the same kind of day balanced on its own, then the combined
// chag+weekend burden, then spacing, then the weighted effort, then the plain
// shift count.
const sortByFairness = (candidates, kind = "regular") =>
  candidates.sort(
    (a, b) =>
      kindCount(a, kind) - kindCount(b, kind) ||
      a.hard - b.hard ||
      Math.round(a.penalty * 10) - Math.round(b.penalty * 10) ||
      a.load - b.load ||
      a.count - b.count ||
      (a.person.full_name || "").localeCompare(b.person.full_name || ""),
  );

const buildCandidateRows = (
  fair,
  people,
  weekKey,
  excludeIds,
  category,
  dayIdxs,
) =>
  people
    .filter((p) => !excludeIds.has(p.serial_id))
    .map((p) => {
      const cats = fair.cats.get(p.serial_id) || emptyCats();
      return {
        person: p,
        capacity: remainingCapacity(fair.weekly, p.serial_id, weekKey),
        count: fair.justice.get(p.serial_id) || 0,
        rangeCount: fair.rangeCount.get(p.serial_id) || 0,
        quota:
          fair.quota == null
            ? null
            : Math.max(
                1,
                Math.ceil(fair.quota - (fair.quotaAdj?.get(p.serial_id) || 0)),
              ),
        cats,
        kindSeed: fair.kindSeed?.get(p.serial_id) || null,
        load: cats.load,
        hard: cats.holidays + cats.weekends,
        ...spacingFor(fair, p.serial_id, dayIdxs, category),
      };
    });

// Rule (e): marks who is inside the total-shifts band — within
// MAX_TOTAL_SPREAD of the lowest total among these candidates, below the range
// quota, and no more than one block (KIND_UNIT days) of the kind being handed
// out above the lowest of that kind.
const KIND_UNIT = {
  holidays: 2,
  weekends: 2,
  thursdays: 1,
  regular: MAX_TOTAL_SPREAD,
};
const markBand = (rows, kind = "regular") => {
  if (rows.length === 0) return rows;
  const minCount = Math.min(...rows.map((r) => r.count));
  const minKind = Math.min(...rows.map((r) => kindCount(r, kind)));
  rows.forEach((r) => {
    r.inBand =
      r.count <= minCount + MAX_TOTAL_SPREAD &&
      kindCount(r, kind) < minKind + KIND_UNIT[kind] + 1 &&
      (r.quota == null || r.rangeCount < r.quota);
  });
  return rows;
};

// Constraints are relaxed in this order, only as far as needed to staff the
// slot: spacing first, then the total band, then adjacency (rule d).
const TIERS = [
  (r) => r.inBand && r.spaced && !r.adjacent,
  (r) => r.inBand && !r.adjacent,
  (r) => !r.adjacent,
  (r) => r.inBand,
  () => true,
];

// Which rules the chosen row breaks — reported back so the admin can see where
// the distribution had to bend.
const relaxedRules = (row) =>
  [
    !row.inBand && "total_band",
    !row.adjacent && !row.spaced && "spacing",
    row.adjacent && "adjacent",
    row.capacity <= 0 && "weekly_cap",
  ].filter(Boolean);

function pickByTiers(rows, kind) {
  for (const test of TIERS) {
    const pool = rows.filter(test);
    if (pool.length > 0) {
      const row = sortByFairness(pool, kind)[0];
      return { person: row.person, relaxed: relaxedRules(row) };
    }
  }
  return null;
}

// Picks the fairest eligible person who still has at least `minCapacity` free
// slots in this week, under the total-band and spacing rules (relaxed tier by
// tier only when nobody fits). Used for ordinary days, where the weekly cap
// (rule a) is a hard limit.
function pickCandidate(
  fair,
  people,
  weekKey,
  minCapacity,
  excludeIds,
  kind,
  dayIdxs,
) {
  const rows = markBand(
    buildCandidateRows(fair, people, weekKey, excludeIds, kind, dayIdxs).filter(
      (r) => r.capacity >= minCapacity,
    ),
    kind,
  );
  return pickByTiers(rows, kind);
}

// Picks who a togetherness bundle (weekend, and/or a chag + its erev — rules
// b/c) should go to as ONE block. The weekly cap is a soft preference here:
// everyone with room is tried first, and only if nobody has room does it fall
// back to the fairest person regardless of it.
function pickTogetherCandidate(fair, people, weekKey, excludeIds, kind, dayIdxs) {
  const rows = buildCandidateRows(fair, people, weekKey, excludeIds, kind, dayIdxs);
  return (
    pickByTiers(markBand(rows.filter((r) => r.capacity > 0), kind), kind) ||
    pickByTiers(markBand(rows, kind), kind)
  );
}

// A holiday share is cut by splitHolidayDays (its חלוקות value or the cuts the
// admin moved in the holiday list), kept together across a Friday/Saturday and
// capped at MAX_SHARE_DAYS days — see src/lib/holidayDivisions.js.
export {
  MAX_SHARE_DAYS,
  capShareLength,
  keepWeekendsTogether,
  splitCholHamoed,
};

/**
 * Spreads Thursday and ordinary-day shifts as far as possible from each
 * person's other shifts, by swapping them between people.
 *
 * Only two shifts of the SAME kind are ever swapped (a Thursday with a
 * Thursday, an ordinary day with an ordinary day), so every person keeps
 * exactly the same number of shifts of each kind and fairness counts do not
 * change. Chag shares and weekends never move. A swap is made only if both
 * people may take their new day: no constraint (אילוץ) on it, and no other
 * shift in that Sunday–Saturday week (rule a).
 *
 * @param {Array<{date: string, personId: number}>} assignments
 * @param {Object} ctx
 * @param {(key: string) => boolean} ctx.isWeekday
 * @param {(key: string) => boolean} ctx.isTogether
 * @param {(personId: number) => number} [ctx.ownerOf]
 * @param {(personId: number, key: string) => boolean} [ctx.isProtected]
 * @param {Array<{original_user_id: number, start_date: string}>} [ctx.fixedShifts]
 */
export function spreadWeekdayShifts(assignments, ctx) {
  const {
    isWeekday,
    isTogether,
    ownerOf = (id) => id,
    isProtected = () => false,
    fixedShifts = [],
    power = WEEKDAY_GAP_POWER,
    maxPasses = WEEKDAY_SPREAD_MAX_PASSES,
  } = ctx;
  const out = assignments.map((a) => ({ ...a }));
  const idxOf = (key) => dayIndex(parseDateKey(key));
  const weekOf = (key) => getWeekKey(parseDateKey(key));
  const gapCost = (g) => Math.pow(Math.max(1, g), -power);

  // Every day each owner holds, and the shifts that may move.
  const days = new Map(); // owner -> [{ idx, key, weekday }]
  const addDay = (owner, key, weekday) => {
    if (!days.has(owner)) days.set(owner, []);
    days.get(owner).push({ idx: idxOf(key), key, weekday });
  };
  fixedShifts.forEach(
    (s) =>
      s?.start_date &&
      addDay(ownerOf(s.original_user_id), String(s.start_date).slice(0, 10), false),
  );
  const movable = [];
  out.forEach((a, i) => {
    const weekday = isWeekday(a.date);
    addDay(ownerOf(a.personId), a.date, weekday);
    if (weekday) {
      const dow = parseDateKey(a.date).getDay();
      movable.push({
        i,
        kind: dow === 4 ? "thursdays" : "regular",
        idx: idxOf(a.date),
        week: weekOf(a.date),
      });
    }
  });

  // Timeline per owner: [start, end, movableKey|null], sorted. Consecutive
  // weekend/chag days form one fixed block; a weekday shift is always its own.
  const timelines = new Map();
  const weekCount = new Map(); // owner -> Map(week -> days)
  const buildTimeline = (owner) => {
    const list = days.get(owner).slice().sort((x, y) => x.idx - y.idx);
    const tl = [];
    list.forEach((d) => {
      const last = tl[tl.length - 1];
      if (
        last &&
        !d.weekday &&
        last[2] == null &&
        d.idx - last[1] === 1 &&
        isTogether(d.key)
      )
        last[1] = d.idx;
      else tl.push([d.idx, d.idx, d.weekday ? d.key : null]);
    });
    timelines.set(owner, tl);
  };
  const costOf = (tl) => {
    let c = 0;
    for (let k = 1; k < tl.length; k++) c += gapCost(tl[k][0] - tl[k - 1][1]);
    return c;
  };
  // Cost of a timeline with the single-day block at `removeIdx` replaced by a
  // single day at `addIdx`, without building a new array.
  const costReplaced = (tl, removeIdx, addIdx) => {
    let c = 0;
    let prevEnd = null;
    let added = false;
    const step = (start, end) => {
      if (prevEnd != null) c += gapCost(start - prevEnd);
      prevEnd = end;
    };
    for (let k = 0; k < tl.length; k++) {
      const [st, en, mk] = tl[k];
      if (mk != null && st === removeIdx) continue;
      if (!added && addIdx < st) {
        step(addIdx, addIdx);
        added = true;
      }
      step(st, en);
    }
    if (!added) step(addIdx, addIdx);
    return c;
  };
  days.forEach((list, owner) => {
    buildTimeline(owner);
    const wk = new Map();
    list.forEach((d) => wk.set(weekOf(d.key), (wk.get(weekOf(d.key)) || 0) + 1));
    weekCount.set(owner, wk);
  });
  const cost = new Map([...timelines].map(([o, tl]) => [o, costOf(tl)]));
  const costBefore = [...cost.values()].reduce((a, b) => a + b, 0);

  const moved = new Set();
  let swaps = 0;
  let passes = 0;
  for (; passes < maxPasses; passes++) {
    let improved = false;
    for (let x = 0; x < movable.length; x++) {
      for (let y = x + 1; y < movable.length; y++) {
        const A = movable[x];
        const B = movable[y];
        if (A.kind !== B.kind) continue;
        const a = out[A.i];
        const b = out[B.i];
        const u = ownerOf(a.personId);
        const v = ownerOf(b.personId);
        if (u === v) continue;
        // both may take their new day: no constraint, nothing else that week
        if (isProtected(a.personId, b.date) || isProtected(b.personId, a.date))
          continue;
        const sameWeek = A.week === B.week;
        if (!sameWeek) {
          if ((weekCount.get(u).get(B.week) || 0) > 0) continue;
          if ((weekCount.get(v).get(A.week) || 0) > 0) continue;
        }
        const tu = timelines.get(u);
        const tv = timelines.get(v);
        const newU = costReplaced(tu, A.idx, B.idx);
        const newV = costReplaced(tv, B.idx, A.idx);
        const delta = newU + newV - cost.get(u) - cost.get(v);
        if (delta >= -1e-12) continue;
        // apply the swap
        const pa = a.personId;
        a.personId = b.personId;
        b.personId = pa;
        const du = days.get(u).find((d) => d.key === a.date);
        const dv = days.get(v).find((d) => d.key === b.date);
        du.key = b.date;
        du.idx = B.idx;
        dv.key = a.date;
        dv.idx = A.idx;
        const wu = weekCount.get(u);
        const wv = weekCount.get(v);
        wu.set(A.week, wu.get(A.week) - 1);
        wu.set(B.week, (wu.get(B.week) || 0) + 1);
        wv.set(B.week, wv.get(B.week) - 1);
        wv.set(A.week, (wv.get(A.week) || 0) + 1);
        buildTimeline(u);
        buildTimeline(v);
        cost.set(u, newU);
        cost.set(v, newV);
        moved.add(a.date);
        moved.add(b.date);
        swaps += 1;
        improved = true;
      }
    }
    if (!improved) {
      passes += 1;
      break;
    }
  }
  const costAfter = [...cost.values()].reduce((a, b) => a + b, 0);
  return {
    assignments: out,
    stats: { passes, swaps, costBefore, costAfter, moved },
  };
}

/**
 * Spreads each person's weekends evenly over the range, as far as possible from
 * their other HEAVY shifts — weekends and chag shares together — by swapping
 * whole weekends (Friday+Saturday) between people.
 *
 * Only plain weekends move (a Fri+Sat block with no chag day in it, both days
 * worked by one person). Chag shares stay where they are but count in every
 * gap. A swap is made only if both people may take their new weekend: no
 * constraint on either day, no other shift in that Sunday–Saturday week, and no
 * shift on the Sunday right after it.
 *
 * @param {Array<{date: string, personId: number}>} assignments
 * @param {Object} ctx
 * @param {Array<{keys: string[]}>} ctx.weekends
 * @param {(key: string) => boolean} ctx.isHeavy
 * @param {string} ctx.startDate
 * @param {string} ctx.endDate
 * @param {(personId: number) => number} [ctx.ownerOf]
 * @param {(personId: number, key: string) => boolean} [ctx.isProtected]
 * @param {Array<{original_user_id: number, start_date: string}>} [ctx.fixedShifts]
 */
export function spreadWeekendShifts(assignments, ctx) {
  const {
    weekends,
    isHeavy,
    startDate,
    endDate,
    ownerOf = (id) => id,
    isProtected = () => false,
    fixedShifts = [],
    power = WEEKEND_GAP_POWER,
    maxPasses = WEEKEND_SPREAD_MAX_PASSES,
  } = ctx;
  const out = assignments.map((a) => ({ ...a }));
  const byDate = new Map(out.map((a) => [a.date, a]));
  const idxOf = (key) => dayIndex(parseDateKey(key));
  const weekOf = (key) => getWeekKey(parseDateKey(key));
  const first = idxOf(startDate);
  const last = idxOf(endDate);
  const gapCost = (g) => Math.pow(Math.max(1, g), -power);

  // Every day each owner holds (for the week / Sunday checks) and their heavy
  // days (for the cost).
  const allDays = new Map(); // owner -> Set(dayIdx)
  const weekCount = new Map(); // owner -> Map(week -> days)
  const heavy = new Map(); // owner -> Set(dayIdx)
  const add = (owner, key) => {
    if (!allDays.has(owner)) {
      allDays.set(owner, new Set());
      weekCount.set(owner, new Map());
      heavy.set(owner, new Set());
    }
    allDays.get(owner).add(idxOf(key));
    const wk = weekCount.get(owner);
    wk.set(weekOf(key), (wk.get(weekOf(key)) || 0) + 1);
    if (isHeavy(key)) heavy.get(owner).add(idxOf(key));
  };
  const remove = (owner, key) => {
    allDays.get(owner).delete(idxOf(key));
    const wk = weekCount.get(owner);
    wk.set(weekOf(key), wk.get(weekOf(key)) - 1);
    heavy.get(owner).delete(idxOf(key));
  };
  fixedShifts.forEach(
    (s) =>
      s?.start_date &&
      add(ownerOf(s.original_user_id), String(s.start_date).slice(0, 10)),
  );
  out.forEach((a) => add(ownerOf(a.personId), a.date));

  // Cost of a set of heavy days: consecutive days form one block. Each gap
  // between blocks costs gap^-power; the stretch before the first block and
  // after the last count double, which spreads the blocks over the whole range.
  const costOf = (daySet, removeA = null, addB = null) => {
    const list = [...daySet].filter((d) => !removeA || !removeA.includes(d));
    if (addB) list.push(...addB);
    list.sort((x, y) => x - y);
    if (list.length === 0) return 0;
    let c = gapCost(2 * (list[0] - first + 1));
    let blockEnd = list[0];
    for (let k = 1; k < list.length; k++) {
      if (list[k] - blockEnd === 1) {
        blockEnd = list[k];
        continue;
      }
      c += gapCost(list[k] - blockEnd);
      blockEnd = list[k];
    }
    c += gapCost(2 * (last - blockEnd + 1));
    return c;
  };
  const cost = new Map([...heavy].map(([o, set]) => [o, costOf(set)]));
  const costBefore = [...cost.values()].reduce((a, b) => a + b, 0);

  const blocks = weekends
    .filter((w) => w.keys.length === 2 && w.keys.every((k) => byDate.has(k)))
    .filter(
      (w) => byDate.get(w.keys[0]).personId === byDate.get(w.keys[1]).personId,
    )
    .map((w) => ({
      keys: w.keys,
      idx: w.keys.map(idxOf),
      week: weekOf(w.keys[0]),
    }));

  // May `owner` (as `personId`) take block B after giving up block A?
  const mayTake = (owner, personId, A, B) => {
    if (B.keys.some((k) => isProtected(personId, k))) return false;
    if ((weekCount.get(owner).get(B.week) || 0) > 0) return false;
    const sunday = B.idx[1] + 1;
    if (allDays.get(owner).has(sunday) && !A.idx.includes(sunday)) return false;
    return true;
  };

  const moved = new Set();
  let swaps = 0;
  let passes = 0;
  for (; passes < maxPasses; passes++) {
    let improved = false;
    for (let x = 0; x < blocks.length; x++) {
      for (let y = x + 1; y < blocks.length; y++) {
        const A = blocks[x];
        const B = blocks[y];
        const pa = byDate.get(A.keys[0]).personId;
        const pb = byDate.get(B.keys[0]).personId;
        const u = ownerOf(pa);
        const v = ownerOf(pb);
        if (u === v) continue;
        if (!mayTake(u, pa, A, B) || !mayTake(v, pb, B, A)) continue;
        const newU = costOf(heavy.get(u), A.idx, B.idx);
        const newV = costOf(heavy.get(v), B.idx, A.idx);
        const delta = newU + newV - cost.get(u) - cost.get(v);
        if (delta >= -1e-12) continue;
        A.keys.forEach((k) => {
          remove(u, k);
          byDate.get(k).personId = pb;
          add(v, k);
          moved.add(k);
        });
        B.keys.forEach((k) => {
          remove(v, k);
          byDate.get(k).personId = pa;
          add(u, k);
          moved.add(k);
        });
        cost.set(u, newU);
        cost.set(v, newV);
        swaps += 1;
        improved = true;
      }
    }
    if (!improved) {
      passes += 1;
      break;
    }
  }
  const costAfter = [...cost.values()].reduce((a, b) => a + b, 0);
  return {
    assignments: out,
    stats: { passes, swaps, costBefore, costAfter, moved },
  };
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
 *      days whenever possible.
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
 *   i. Weekends are spread evenly over the range, chag shares included in the
 *      measurement (spreadWeekendShifts).
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
    ? applyHistory(holidayState, holidayPool, holidayUsers.history, startDate, holidayByDate)
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
    .map((bundle, index) => ({
      bundle,
      index,
      prio: bundlePriority(bundle),
      load: pressure(bundle),
    }))
    .sort((a, b) => a.prio - b.prio || b.load - a.load || a.index - b.index)
    .map((entry) => entry.bundle);

  const assignments = [];
  const skipped = [];
  const relaxations = [];

  const firstBundle = bundles[0];

  orderedBundles.forEach((bundle) => {
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
        // A holiday share taken by a group member also uses up that group's
        // weekly slot, total and spacing.
        const repId = useUserFairness ? holidayGroupRepOf.get(personId) : null;
        if (repId != null && repId !== personId) {
          recordAssignment(groupFair, repId, day.weekKey, day.date, category);
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
            if (!pick) {
              pick = pickTogetherCandidate(
                fair,
                fairPool,
                today.weekKey,
                excluded,
                "holidays",
                shareIdxs,
              );
            }
            if (!pick) {
              pick = pickTogetherCandidate(
                fair,
                fairPool,
                today.weekKey,
                firstDayExcluded,
                "holidays",
                shareIdxs,
              );
            }
            if (!pick && holidayTried.size > 0) {
              pick = pickTogetherCandidate(
                fair,
                fairPool,
                today.weekKey,
                protectedOnDate(today.key),
                "holidays",
                shareIdxs,
              );
            }
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
        const pick = anchorPerson
          ? { person: anchorPerson, relaxed: [] }
          : carryPerson
            ? { person: carryPerson, relaxed: [] }
            : pickTogetherCandidate(
                fair,
                fairPool,
                segment.weekKey,
                togetherExcluded,
                "weekends",
                emptyDays.map((d) => dayIndex(d.date)),
              );

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
  });

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
        const repId = userPool ? holidayGroupRepOf.get(chosen.serial_id) : null;
        if (repId != null && repId !== chosen.serial_id) {
          recordAssignment(groupFair, repId, day.weekKey, day.date, category);
        }
      });
    skipped.length = 0;
    stillSkipped.forEach((entry) => skipped.push(entry));
  }

  // Thursdays and ordinary days: swap same-kind shifts between people while it
  // spreads everyone's shifts further apart (counts per kind don't change).
  const togetherKeys = new Set(days.filter((d) => d.kind === "together").map((d) => d.key));
  const weekdayKeys = new Set(days.filter((d) => d.kind === "regular").map((d) => d.key));

  // Weekends first: swap whole Fri+Sat blocks so each person's heavy shifts
  // (weekends + chag shares) are spread evenly and as far apart as possible.
  const plainWeekends = bundles
    .filter((b) => b.kind === "together" && !b.days.some((d) => holidayByDate.has(d.key) || d.existing))
    .filter((b) => b.days.length === 2 && b.days[0].date.getDay() === 5 && b.days[1].date.getDay() === 6)
    .filter((b) => !b.days.some((d) => lastResortDates.has(d.key)))
    .map((b) => ({ keys: b.days.map((d) => d.key) }));
  const weekendSpread = spreadWeekends
    ? spreadWeekendShifts(assignments, {
        weekends: plainWeekends,
        isHeavy: (key) => togetherKeys.has(key),
        startDate,
        endDate,
        ownerOf: (id) => holidayGroupRepOf.get(id) ?? id,
        isProtected,
        fixedShifts: inRangeShifts,
      })
    : null;
  const afterWeekends = weekendSpread ? weekendSpread.assignments : assignments;

  const spread = spreadWeekdays
    ? spreadWeekdayShifts(afterWeekends, {
        isWeekday: (key) => weekdayKeys.has(key),
        isTogether: (key) => togetherKeys.has(key),
        ownerOf: (id) => holidayGroupRepOf.get(id) ?? id,
        isProtected,
        fixedShifts: inRangeShifts,
      })
    : null;
  const spreadAssignments = spread ? spread.assignments : afterWeekends;
  // A relaxation recorded for a day that has since changed hands no longer
  // describes who works it, so it is dropped.
  const movedDays = new Set([
    ...(weekendSpread ? weekendSpread.stats.moved : []),
    ...(spread ? spread.stats.moved : []),
  ]);
  const keptRelaxations = relaxations.filter((r) => !movedDays.has(r.date));

  // Spacing refinement: the greedy pass decides day by day, with spacing only
  // as a soft tiebreaker, so its result is kept as the seed and the blocks are
  // moved/swapped a few times to even out the gaps per kind.
  const refined = refine
    ? refineSpacing(spreadAssignments, {
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
  const finalAssignments = refined ? refined.assignments : spreadAssignments;

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
    applyHistory(finalHolidayState, holidayPool, holidayUsers.history, startDate, holidayByDate);
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