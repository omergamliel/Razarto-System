import { format, startOfWeek } from "date-fns";

// ---------------------------------------------------------------------------
// Shared primitives of the distribution algorithm: day categories, dates,
// fairness state, candidate rows and the picking tiers.
// ---------------------------------------------------------------------------

// No one may be assigned more than this many shifts within a single
// (Sunday-Saturday) calendar week — rule (a). A togetherness block (Fri+Sat, or
// a chag + its erev — rules b/c) is the deliberate exception: it still goes to
// one person as a single unit even though it spans two days of the same week.
export const WEEKLY_CAP = 1;

// Rule (e) — total-shifts regulation. When a slot is filled, candidates whose
// total is more than MAX_TOTAL_SPREAD above the lowest are held back, and so is
// anyone who already reached their quota for the range
// (ceil(days in range / people)). Both are relaxed only when nobody inside them
// can take the slot.
export const MAX_TOTAL_SPREAD = 1;

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
export const WEEKDAY_GAP_POWER = 3;
export const WEEKDAY_SPREAD_MAX_PASSES = 40;

// Weekends: whole Fri+Sat blocks are swapped so each person's HEAVY shifts —
// weekends and chag shares together — are spread evenly over the range.
export const WEEKEND_GAP_POWER = 3;
export const WEEKEND_SPREAD_MAX_PASSES = 40;
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

// Rule (j) — the weekly rhythm is discouraged. Two patterns are counted:
//   - a shift exactly a week after another one (the same weekday, week after
//     week), i.e. "a week between them";
//   - a shift in the Sun–Sat week right before or right after a week the person
//     already works in ("week after week").
// A rotation shouldn't settle into a weekly routine, so a candidate that would
// create one is pushed down the order — but only AFTER fairness and the heavy
// day balance, so this can never take a slot from someone who is owed it.
const WEEK_DAYS = 7;

// Index of the Sunday opening the Sun–Sat week of a whole-day index.
const weekStartOf = (idx) =>
  idx - ((((idx + 4) % WEEK_DAYS) + WEEK_DAYS) % WEEK_DAYS);

// How many of the person's existing shifts form a weekly-rhythm pattern with
// the day(s) about to be given out. 0 = no pattern.
function weekRhythm(fair, personId, dayIdxs) {
  const list = fair.assigned.get(personId);
  if (!list || list.length === 0 || !dayIdxs || dayIdxs.length === 0) return 0;
  const weekStarts = dayIdxs.map(weekStartOf);
  let hits = 0;
  for (const other of list) {
    const otherWeek = weekStartOf(other.day);
    const repeats =
      dayIdxs.some((idx) => Math.abs(other.day - idx) === WEEK_DAYS) ||
      weekStarts.some((week) => Math.abs(week - otherWeek) === WEEK_DAYS);
    if (repeats) hits += 1;
  }
  return hits;
}

export const toDateKey = (date) => format(date, "yyyy-MM-dd");

// Parses 'yyyy-MM-dd' (or an ISO string starting with it) as LOCAL midnight, so
// the weekday and week key never shift by a day across time zones.
export const parseDateKey = (key) =>
  new Date(`${String(key).slice(0, 10)}T00:00:00`);

// A whole-day index (DST-safe) for fast gap arithmetic.
export const dayIndex = (date) =>
  Math.round(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000,
  );

// Sunday-based week key, matching the week boundaries used elsewhere in the app.
export const getWeekKey = (date) =>
  toDateKey(startOfWeek(date, { weekStartsOn: 0 }));

// How heavy each kind of day is for the person working it, so fairness is
// measured on weighted effort and not on a plain day count.
const CATEGORY_WEIGHT = { holidays: 3, weekends: 2.5, thursdays: 1.5, regular: 1 };

// The fairness category of a day — a chag day wins over its weekday.
export const categorizeDay = (dateKey, holidayByDate) => {
  const key = String(dateKey).slice(0, 10);
  if (holidayByDate.has(key)) return "holidays";
  const dow = parseDateKey(key).getDay();
  if (dow === 5 || dow === 6) return "weekends";
  if (dow === 4) return "thursdays";
  return "regular";
};

export const emptyCats = () => ({
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
export function recordAssignment(fair, personId, weekKey, date, category) {
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
export function initState(
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
export function applyHistory(
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
export function computeIdealGaps(days, poolSize, holidayByDate) {
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
export const nearestGap = (fair, personId, dayIdxs, group) => {
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

export const remainingCapacity = (weekly, personId, weekKey) =>
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

// A rerun never repeats the same calendar: every run draws its tie-breaks from
// its own seeded generator, so two runs on the same data are both fair but not
// identical (mulberry32 — small, fast, and enough for tie-breaking).
export function makeRng(seed) {
  let a = (Number(seed) || 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fairest first: the same kind of day balanced on its own, then the combined
// chag+weekend burden, then the weekly rhythm (rule j), then spacing, then the
// weighted effort, then the plain shift count.
const sortByFairness = (candidates, kind = "regular") =>
  candidates.sort(
    (a, b) =>
      kindCount(a, kind) - kindCount(b, kind) ||
      a.hard - b.hard ||
      a.weekRhythm - b.weekRhythm ||
      Math.round(a.penalty * 10) - Math.round(b.penalty * 10) ||
      a.load - b.load ||
      a.count - b.count ||
      // A per-run random tie-break: two people who are equally fair to pick are
      // not always picked in the same order, so a rerun gets a different (yet
      // just as fair) calendar.
      a.tie - b.tie ||
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
        tie: fair.rng ? fair.rng() : 0,
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
        weekRhythm: weekRhythm(fair, p.serial_id, dayIdxs),
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
export function pickCandidate(
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
export function pickTogetherCandidate(
  fair,
  people,
  weekKey,
  excludeIds,
  kind,
  dayIdxs,
) {
  const rows = buildCandidateRows(fair, people, weekKey, excludeIds, kind, dayIdxs);
  return (
    pickByTiers(markBand(rows.filter((r) => r.capacity > 0), kind), kind) ||
    pickByTiers(markBand(rows, kind), kind)
  );
}