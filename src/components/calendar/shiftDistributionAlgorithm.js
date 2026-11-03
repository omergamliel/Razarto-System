import { addDays, differenceInCalendarDays, format, startOfWeek } from "date-fns";
import { splitHolidayDays } from "@/lib/holidayDivisions";
import { refineSpacing } from "@/components/calendar/spacingRefinement";

// No one may be assigned more than this many shifts within a single
// (Sunday-Saturday) calendar week — tasks.txt rule (a). One shift per week.
// A togetherness block (Fri+Sat, or a chag + its erev — rules b/c) is the
// deliberate exception: it still goes to one person as a single unit even
// though it spans two days that fall in the same week.
const WEEKLY_CAP = 1;

// Rule (e) — total-shifts regulation. When a slot is filled, candidates whose
// total shift count is more than MAX_TOTAL_SPREAD above the lowest available
// candidate are held back, and so is anyone who already reached their fair
// quota for the range (ceil(days in range / people)). Both are relaxed only
// when nobody inside them can take the slot.
const MAX_TOTAL_SPREAD = 1;

// Rule (f) — spacing regulation per kind of day. If a kind of day occurs N
// times in the range and P people share it, each person gets about N/P of
// them, so the same person's occurrences should be about range/(N/P) days
// apart. A candidate closer than SPACING_TOLERANCE of that ideal gap is held
// back while someone better spaced is available.
const SPACING_TOLERANCE = 0.6;
// Rule (d): two shifts closer than this (i.e. calendar-adjacent) are never
// "comfortable".
const MIN_GAP_ANY = 2;

// Past shifts (the `history` option): shifts this many days before the range
// start still count for spacing and the weekly cap, so whoever worked on
// 31 Dec isn't handed 1 Jan. Older history only seeds the fairness counts.
const DEFAULT_LOOKBACK_DAYS = 42;
const DAY_CATEGORIES = ["holidays", "weekends", "thursdays", "regular"];

// Which spacing groups a newly assigned day is measured against.
// "hard" = chags and weekends together, so whoever just took a chag isn't
// handed a weekend right after it (and vice versa); "any" = every shift.
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

// Parses 'yyyy-MM-dd' (or an ISO string starting with it) as LOCAL midnight,
// so the weekday and week key never shift by a day across time zones.
const parseDateKey = (key) => new Date(`${String(key).slice(0, 10)}T00:00:00`);

// A whole-day index (DST-safe) for fast gap arithmetic.
const dayIndex = (date) =>
  Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);

// Sunday-based week key, matching the week boundaries already used
// elsewhere in the app (CalendarGrid's { weekStartsOn: 0 }).
const getWeekKey = (date) => toDateKey(startOfWeek(date, { weekStartsOn: 0 }));

// How heavy each kind of day is for the person working it. The policy order
// (chag → weekend → Thursday → ordinary day) is also the order of effort, so
// fairness is measured on weighted effort and not on a plain day count: two
// people can hold the same number of shifts and still be very unequal if one
// of them took the chags and the weekends.
const CATEGORY_WEIGHT = { holidays: 3, weekends: 2.5, thursdays: 1.5, regular: 1 };

// The fairness category of a day — a chag day wins over its weekday, matching
// the tabs of טבלת צדק.
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
// shift counts, and every day each person already holds — all from shifts
// that fall INSIDE [startDate, endDate] only. Only the justice count is seeded
// with history from before the range (`priorJustice`); the quota, weekly cap
// and spacing bookkeeping are about days INSIDE the range.
function initState(people, inRangeShifts, priorJustice = new Map(), holidayByDate = new Set()) {
  const fair = {
    justice: new Map(),
    rangeCount: new Map(),
    cats: new Map(),
    weekly: new Map(),
    // personId -> [{ day, category }] — every assigned day, not just the latest,
    // because bundles are staffed out of calendar order (chags first, then
    // weekends, …) and the nearest neighbour can be before OR after a date.
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
    recordAssignment(fair, personId, getWeekKey(d), d, categorizeDay(s.start_date, holidayByDate));
  });

  fair.pastRaw = new Map();
  fair.quotaAdj = new Map();
  return fair;
}

/**
 * Seeds a fairness state with shifts from BEFORE the range (the `history`
 * option). Two modes:
 *   - "normalized" (default): each person is seeded with how far they are
 *     above or below their fair share of the past, per kind of day. The fair
 *     share is the pool's rate per active day × the days that person was
 *     active (from `activeFrom`, or the start of the window). Someone who
 *     joined yesterday starts at 0, neither owing nor owed, so a turnover of
 *     half the people doesn't dump every chag and weekend on the newcomers.
 *   - "raw": each person is seeded with their plain past counts, like
 *     `priorJustice`. Newcomers then look under-loaded and absorb shifts until
 *     they catch up with the veterans.
 * Shifts within `lookbackDays` of the start are also recorded for spacing and
 * the weekly cap. People who are no longer in the pool are ignored, and a
 * shift owned by someone outside the pool is credited to `resolveId(owner)`
 * when that is in the pool (e.g. a group member → the group representative).
 *
 * Returns the owner of each past date (used to carry a Fri+Sat or chag block
 * that the range start cuts in half), or null when there's no history.
 */
function applyHistory(fair, pool, history, startDate, holidayByDate, resolveId = () => null) {
  if (!history || !Array.isArray(history.shifts) || history.shifts.length === 0) return null;
  const mode = history.mode === "raw" ? "raw" : "normalized";
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
    const id = ids.has(s.original_user_id) ? s.original_user_id : resolveId(s.original_user_id);
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
    DAY_CATEGORIES.forEach((cat) => {
      const seed = mode === "raw" ? past[cat] : past[cat] - rate[cat] * days;
      cats[cat] += seed;
      cats.load += CATEGORY_WEIGHT[cat] * seed;
      seedTotal += seed;
      rawTotal += past[cat];
    });
    fair.justice.set(id, (fair.justice.get(id) || 0) + seedTotal);
    fair.pastRaw.set(id, rawTotal);
    // Someone owed shifts may go above the plain quota to catch up, and
    // someone ahead stops earlier.
    if (mode === "normalized") fair.quotaAdj.set(id, seedTotal);
  });
  return owners;
}

// Ideal per-person gap (in days) for each spacing group, for a pool of
// `poolSize` people sharing the range. Occasions are counted in assignment
// units: a weekend is one Fri+Sat block, a chag share is ~2 days (the default
// חלוקות size).
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
//   penalty  — 0 when every gap is at least ideal, growing as gaps shrink; used
//              as a soft tiebreaker so people rotate evenly within each kind.
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

// The count that must stay balanced for the kind of block being handed out:
// chags against chags, weekends against weekends, Thursdays against Thursdays,
// and an ordinary day against the overall number of shifts.
const kindCount = (row, kind) => {
  if (kind === "holidays") return row.cats.holidays;
  if (kind === "weekends") return row.cats.weekends;
  if (kind === "thursdays") return row.cats.thursdays;
  return row.count;
};

// Fairest first: the same kind of day balanced on its own, then the combined
// chag+weekend burden (so whoever took the chags isn't handed the weekends
// too), then spacing (whoever's last shift of this kind is furthest away),
// then the weighted effort, then the plain shift count.
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

const buildCandidateRows = (fair, people, weekKey, excludeIds, category, dayIdxs) =>
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
            : Math.max(1, Math.ceil(fair.quota - (fair.quotaAdj?.get(p.serial_id) || 0))),
        cats,
        load: cats.load,
        hard: cats.holidays + cats.weekends,
        ...spacingFor(fair, p.serial_id, dayIdxs, category),
      };
    });

// Rule (e): marks who is inside the total-shifts band — within
// MAX_TOTAL_SPREAD of the lowest total among these candidates, and below the
// range quota when the pool has one (adjusted per person by their history).
// The band also covers the kind of day being handed out: a candidate is only
// in band while they hold no more than one block (KIND_UNIT days) of that kind
// above the lowest, so whoever has the fewest weekends (or chags, or
// Thursdays) isn't passed over just because spacing prefers someone else.
const KIND_UNIT = { holidays: 2, weekends: 2, thursdays: 1, regular: MAX_TOTAL_SPREAD };
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

// Which rules the chosen row breaks — reported back so the admin can see
// where the distribution had to bend.
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
// tier only when nobody fits). Used for ordinary days,
// where the weekly cap (rule a) is a hard limit.
function pickCandidate(fair, people, weekKey, minCapacity, excludeIds, kind, dayIdxs) {
  const rows = markBand(
    buildCandidateRows(fair, people, weekKey, excludeIds, kind, dayIdxs).filter(
      (r) => r.capacity >= minCapacity,
    ),
    kind,
  );
  return pickByTiers(rows, kind);
}

// Picks who a togetherness bundle (weekend, and/or a chag + its erev — see
// rules b/c) should go to as ONE block. The weekly cap is a soft preference
// here: everyone with room is tried first (through all tiers), and only if
// nobody has room does it fall back to the fairest person regardless of it.
function pickTogetherCandidate(fair, people, weekKey, excludeIds, kind, dayIdxs) {
  const rows = buildCandidateRows(fair, people, weekKey, excludeIds, kind, dayIdxs);
  return (
    pickByTiers(markBand(rows.filter((r) => r.capacity > 0), kind), kind) ||
    pickByTiers(markBand(rows, kind), kind)
  );
}

// How a chag's days are shared between people — its חלוקות value (two shifts per
// person by default) or the partitions the admin moved in the strip — lives in
// src/lib/holidayDivisions.js (splitHolidayDays), so the admin preview and this
// distribution always agree on the same parts.

// Splits a run of Chol HaMoed days into two-day shares; an odd last day joins
// the share before it (a three-day share) instead of standing alone.
export function splitCholHamoed(keys) {
  const parts = [];
  for (let i = 0; i < keys.length; i += 2) parts.push(keys.slice(i, i + 2));
  if (parts.length > 1 && parts[parts.length - 1].length === 1) {
    parts[parts.length - 2].push(parts.pop()[0]);
  }
  return parts;
}

// Nobody works more than this many chag days in a row. A longer share is cut
// into another share, so a chag is spread across people instead of landing as
// one long stretch. Friday+Saturday still stay together: a cut is never placed
// between a Friday and the Saturday after it.
export const MAX_SHARE_DAYS = 2;

/**
 * Cuts every share longer than `maxDays` into shares of at most that many
 * consecutive days, never cutting between a Friday and the Saturday after it.
 *
 * @param {string[][]} parts - shares of 'yyyy-MM-dd' keys, in order
 * @returns {string[][]}
 */
export function capShareLength(parts, maxDays = MAX_SHARE_DAYS) {
  const out = [];
  (parts || []).forEach((part) => {
    const keys = part || [];
    let i = 0;
    while (i < keys.length) {
      let take = Math.min(maxDays, keys.length - i);
      while (take > 1 && i + take < keys.length) {
        const last = parseDateKey(keys[i + take - 1]);
        const next = parseDateKey(keys[i + take]);
        if (last.getDay() === 5 && next.getDay() === 6) take -= 1;
        else break;
      }
      out.push(keys.slice(i, i + take));
      i += take;
    }
  });
  return out.filter((part) => part.length > 0);
}

/**
 * Keeps a weekend inside one chag share (rules b/c). When a share boundary
 * falls between a Friday and the Saturday right after it — e.g. a two-day
 * share on Thursday–Friday with Saturday starting the next share — the
 * Saturday moves into the share that holds the Friday, so nobody comes in for
 * a lone Saturday. A share left empty by the move is dropped.
 *
 * Exported so the admin preview of the divisions can show the same parts:
 * call it on the result of splitHolidayDays there too.
 *
 * @param {string[][]} parts - consecutive shares of 'yyyy-MM-dd' keys, in order
 * @returns {string[][]}
 */
export function keepWeekendsTogether(parts) {
  const out = parts.map((part) => [...part]).filter((part) => part.length > 0);
  for (let i = 0; i < out.length - 1; i++) {
    const last = out[i][out[i].length - 1];
    const next = out[i + 1][0];
    if (!last || !next) continue;
    const fri = parseDateKey(last);
    const sat = parseDateKey(next);
    const consecutive = dayIndex(sat) - dayIndex(fri) === 1;
    if (consecutive && fri.getDay() === 5 && sat.getDay() === 6) {
      out[i].push(out[i + 1].shift());
      if (out[i + 1].length === 0) {
        out.splice(i + 1, 1);
        i -= 1;
      }
    }
  }
  return out;
}

/**
 * Distributes shifts across [startDate, endDate] as fairly as possible.
 * Only shifts that fall inside this range are ever looked at — the
 * algorithm has no dependency on shift history from before `startDate`
 * (except `priorJustice`, which only seeds the fairness ranking).
 *
 * Rules (from tasks.txt), all applied together:
 *   a. No more than one shift for one person within a single Sun-Sat week
 *      (a Fri+Sat / chag togetherness block, rules b/c, is the deliberate
 *      exception and still counts as that person's one unit for the week).
 *   b. Friday + Saturday go together to one person, not split.
 *   c. Same togetherness rule as (b), but for holidays — including the chag's
 *      erev. Holiday days that are straight next to each other — erev, chag,
 *      Chol HaMoed and any weekend among them — form one block, which is
 *      divided into shares (the chag's חלוקות, two-day shares across Chol
 *      HaMoed), each share to one person, so a long Pesach or Sukkot is shared
 *      out without anyone working a lone Chol HaMoed day.
 *      When a chag share touches a weekend, the Friday and Saturday stay in
 *      the same share (a Thu–Fri share takes the Saturday too — see
 *      keepWeekendsTogether), and a share goes to someone free on all its days
 *      whenever possible, so a constraint doesn't leave a lone Saturday.
 *   d. Shifts should be spread out comfortably — a person shouldn't land two
 *      calendar-adjacent days by accident from two separate decisions.
 *   e. Total shifts stay balanced: nobody is handed a slot while someone
 *      available holds more than MAX_TOTAL_SPREAD fewer shifts, or after
 *      reaching their range quota (ceil(days / people)).
 *   f. Each kind of day is spaced per person: chags from chags, weekends from
 *      weekends, chags+weekends from each other ("hard" days), Thursdays from
 *      Thursdays, and any shift from any shift — each against an ideal gap
 *      derived from how often that kind occurs in the range.
 *
 * Rules (d), (e) and (f) are soft: they are relaxed in the order f → e → d
 * only when no candidate satisfies them, so a day is never left unstaffed
 * because of them. Every relaxation is reported in `relaxations`.
 *
 * Past shifts (`history`, and `holidayUsers.history` for the per-user chag
 * pool) are optional. Without them the range is distributed on its own, as
 * before. With them, past fairness carries over per kind of day (see
 * applyHistory), recent shifts count for spacing across the range start, and
 * a Fri+Sat or chag block that the range start cuts in half stays with the
 * person who worked its first part.
 *
 * @param {Object} params
 * @param {Array<{serial_id: number, full_name: string}>} params.people - eligible people
 * @param {Array<{original_user_id: number, start_date: string}>} params.existingShifts - shifts to check against; only ones inside [startDate, endDate] are used
 * @param {string} params.startDate - 'yyyy-MM-dd'
 * @param {string} params.endDate - 'yyyy-MM-dd'
 * @param {Set<string>} [params.holidayDates] - Set of 'yyyy-MM-dd' holiday dates (chag days AND erev-chag days)
 * @param {Set<string>} [params.cholHamoedDates] - Set of 'yyyy-MM-dd' Chol HaMoed dates; they join the holiday block around them and count as holiday days for fairness
 * @param {Map<string, number>} [params.holidayDivisions] - Map of 'yyyy-MM-dd' -> how many divisions that holiday's shifts are split among.
 * @param {Array<{start_date: string, end_date?: string, divisions?: number, division_breaks?: string[]}>} [params.holidays] - Holiday records (the Holiday entity).
 * @param {Map<number, Set<string>>} [params.protectedDates] - Map of serial_id -> Set of 'yyyy-MM-dd' dates the person set a constraint (אילוץ) for.
 * @param {Map<number, number>} [params.priorJustice] - Map of serial_id -> shift count from BEFORE the range; seeds the fairness ranking only.
 * @param {{shifts: Array<{original_user_id: number, start_date: string}>, from?: string, activeFrom?: Map<number, string>, headcount?: number, mode?: "normalized"|"raw", lookbackDays?: number}} [params.history] - Shifts BEFORE startDate for the group pool, owned the same way as existingShifts (group representative). Include shifts by people who have since left: they set the fair rate. `from` is the first day the history covers; `activeFrom` maps a person to the day they joined (missing = active for the whole window); `headcount` is how many people shared the past work (default: the current pool size); `mode` defaults to "normalized"; `lookbackDays` (default 42) is how far back shifts still count for spacing. A shift owned by a group member is credited to their group through `holidayUsers.groupRepOf`.
 * @param {{people: Array, existingShifts?: Array, groupRepOf?: Map<number, number>, protectedDates?: Map<number, Set<string>>, history?: Object}} [params.holidayUsers] - Per-USER pool for holiday blocks. `history` has the same shape as params.history, with each user's own past chag shares and each user's join date.
 * @returns {{
 *   assignments: Array<{date: string, personId: number}>,
 *   skipped: Array<{date: string, reason: string}>,
 *   relaxations: Array<{date: string, personId: number, rules: string[]}>,
 *   justiceTable: Array<{personId: number, name: string, totalShifts: number, pastShifts: number, rangeShifts: number, balance: number, holidays: number, weekends: number, thursdays: number, regular: number, load: number}>,
 *   holidayTable: Array<same as justiceTable> | null
 * }}
 * In the tables, totalShifts = prior + past + in-range shift days, and the
 * per-kind columns and `balance` are the fairness scores the algorithm ranks
 * on (in "normalized" mode they include the carried-over surplus or deficit,
 * so they can be fractional or negative).
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
}) {
  const holidayByDate = new Set(holidayDates);
  const divisionByDate = new Map(holidayDivisions);
  const breaksByDate = new Map();
  (holidays || []).forEach((holiday) => {
    if (!holiday?.start_date) return;
    const first = parseDateKey(holiday.start_date);
    const last = parseDateKey(holiday.end_date || holiday.start_date);
    if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return;
    for (const day = first; day <= last; day.setDate(day.getDate() + 1)) {
      const key = toDateKey(day);
      holidayByDate.add(key);
      divisionByDate.set(key, Math.max(1, Number(holiday.divisions) || 1));
      const movedBreaks = (holiday.division_breaks || []).filter(Boolean);
      if (movedBreaks.length > 0) breaksByDate.set(key, movedBreaks);
    }
  });
  // Chol HaMoed days are holiday days too: a run of holiday days that are
  // straight next to each other (erev, chag, Chol HaMoed, and the weekends
  // among them) is one block, divided into shares between people.
  const cholHamoedKeys = new Set([...cholHamoedDates].map((k) => String(k).slice(0, 10)));
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
  const holidayPool = (holidayUsers?.people || []).filter((p) => p?.serial_id != null);
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
      existing: existingByDate.get(key) || null,
    });
  }

  // Rule (e)/(f) parameters, derived from the range itself. The quota is
  // rounded up per person (after their history adjustment) in
  // buildCandidateRows.
  groupFair.idealGaps = computeIdealGaps(days, people.length, holidayByDate);
  groupFair.quota = days.length / Math.max(1, people.length);
  if (holidayState) {
    holidayState.idealGaps = computeIdealGaps(days, holidayPool.length, holidayByDate);
    // Holiday users share only the chag days, so they are held to the
    // relative band (rule e) without an absolute quota.
    holidayState.quota = null;
  }

  // Past shifts: seed fairness, spacing and the weekly cap from before the range.
  const groupOwners = applyHistory(groupFair, people, history, startDate, holidayByDate, (id) =>
    holidayGroupRepOf.get(id),
  );
  const userOwners = holidayState
    ? applyHistory(holidayState, holidayPool, holidayUsers.history, startDate, holidayByDate)
    : null;
  // If the range starts in the middle of a Fri+Sat or chag block (e.g. a
  // range starting on a Saturday), the first block stays with whoever worked
  // the day before (rules b/c).
  const prevKey = toDateKey(addDays(start, -1));
  const prevDow = parseDateKey(prevKey).getDay();
  const prevTogether =
    prevDow === 5 ||
    prevDow === 6 ||
    holidayByDate.has(prevKey);
  const carryGroupId = prevTogether ? (groupOwners?.get(prevKey) ?? null) : null;
  const carryUserId = prevTogether ? (userOwners?.get(prevKey) ?? null) : null;

  // Group into bundles: consecutive days of the SAME kind chain into one
  // bundle — except "regular" days, which always stay their own bundle.
  const bundles = [];
  let current = null;
  days.forEach((day) => {
    if (day.kind !== "regular" && current?.kind === day.kind) {
      current.days.push(day);
    } else {
      current = { kind: day.kind, days: [day] };
      bundles.push(current);
    }
  });

  // Dates that belong to a bundle holding a chag: those are staffed from the
  // per-user pool (see the holiday branch below), and they are needed again
  // when the fairness tables are rebuilt after spacing refinement.
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
  // Within the same priority, ordinary days that more people are blocked on
  // (constraints) go first, while there is still a choice of who takes them —
  // otherwise the weekly cap can leave nobody free for them at the end.
  const pressure = (bundle) =>
    bundlePriority(bundle) >= 2
      ? Math.max(...bundle.days.map((d) => protectedOnDate(d.key).size))
      : 0;
  const orderedBundles = bundles
    .map((bundle, index) => ({ bundle, index, prio: bundlePriority(bundle), load: pressure(bundle) }))
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
      // partitions as before; a Chol HaMoed piece gets two-day shares, with an
      // odd day joining a neighbouring share instead of standing alone. Then a
      // Friday and its Saturday are kept in one share across all pieces.
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
      // Friday and Saturday — so a chag never hands one person a long stretch.
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
            // The share this person would take (the rest of it, if a
            // constraint cut the previous holder short).
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
              continuesPast && day === 0 && holidayTried.size === 0 && carryId != null && !firstDayExcluded.has(carryId)
                ? fairPool.find((p) => p.serial_id === carryId)
                : null;
            let pick = anchorFits
              ? { person: anchorPerson, relaxed: [] }
              : carryPerson
                ? { person: carryPerson, relaxed: [] }
                : null;
            if (!pick) {
              pick = pickTogetherCandidate(fair, fairPool, today.weekKey, excluded, "holidays", shareIdxs);
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

  // Spacing refinement: the greedy pass decides day by day, with spacing only
  // as a soft tiebreaker, so it can still leave one person with two weekends (or
  // two chag shares) in back-to-back weeks. Its result is kept as the seed and
  // the blocks are moved/swapped a few times to even out the gaps per kind.
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
  const finalAssignments = refined ? refined.assignments : assignments;

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
    relaxations,
    justiceTable: table(finalGroupFair, people, priorJustice),
    holidayTable: finalHolidayState ? table(finalHolidayState, holidayPool, new Map()) : null,
    spacing: refined ? refined.stats : null,
  };
}