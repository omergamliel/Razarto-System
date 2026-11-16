import {
  WEEKDAY_GAP_POWER,
  WEEKDAY_SPREAD_MAX_PASSES,
  WEEKEND_GAP_POWER,
  WEEKEND_SPREAD_MAX_PASSES,
  dayIndex,
  getWeekKey,
  makeRng,
  parseDateKey,
} from "@/components/calendar/distributionCore";

// ---------------------------------------------------------------------------
// Post-passes that improve an already staffed calendar: weekday spreading,
// weekend spreading, and the week-spacing search.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Week spacing: fewer shifts in back-to-back weeks or with one empty week
// between them
// ---------------------------------------------------------------------------

// Penalties for two consecutive shifts of one person by how many Sunday–Saturday
// weeks apart they are: same week, the next week ("week after week"), two
// weeks later ("every other week"). They dominate the day-gap cost on purpose.
const WEEK_GAP_PENALTY = { 0: 1000, 1: 450, 2: 150 };
// Sunday-based week number of a day index (day 3 = Sunday 4 Jan 1970).
const weekNumber = (idx) => Math.floor((idx + 4) / 7);


/**
 * Spacing statistics of a finished calendar, per person and overall. A
 * "shift" here is a unit of work: a weekend (Fri+Sat) or a chag share counts
 * once, a Thursday or an ordinary day counts once.
 *
 * @returns {{
 *   perPerson: Array<{personId, units, weekAfterWeek, everyOtherWeek, minGap, avgGap, maxGap, heavyMinGap}>,
 *   weekAfterWeek: number, everyOtherWeek: number, sameWeek: number,
 *   worstMinGap: number, avgMinGap: number, worstHeavyMinGap: number, cost: number
 * }}
 */
export function spacingScore(assignments, { isTogether, isHeavy = isTogether, ownerOf = (id) => id, startDate, endDate }) {
  const first = dayIndex(parseDateKey(startDate));
  const last = dayIndex(parseDateKey(endDate));
  const span = last - first + 1;
  const byOwner = new Map();
  assignments.forEach((a) => {
    const o = ownerOf(a.personId);
    if (!byOwner.has(o)) byOwner.set(o, []);
    byOwner.get(o).push(a.date);
  });
  const perPerson = [];
  let cost = 0;
  byOwner.forEach((dates, owner) => {
    const units = unitsOf(dates.sort(), isTogether, isHeavy);
    const c = ownerCost(units, first, last, span);
    cost += c.cost;
    perPerson.push({ personId: owner, units: units.length, ...c.stats });
  });
  const sum = (k) => perPerson.reduce((a, p) => a + p[k], 0);
  return {
    perPerson,
    sameWeek: sum("sameWeek"),
    weekAfterWeek: sum("weekAfterWeek"),
    everyOtherWeek: sum("everyOtherWeek"),
    worstMinGap: Math.min(...perPerson.map((p) => p.minGap)),
    avgMinGap: perPerson.reduce((a, p) => a + (Number.isFinite(p.minGap) ? p.minGap : 0), 0) / Math.max(1, perPerson.length),
    worstHeavyMinGap: Math.min(...perPerson.map((p) => p.heavyMinGap)),
    cost,
  };
}

// Units of one person's sorted days: consecutive weekend/chag days are one unit.
function unitsOf(sortedDates, isTogether, isHeavy) {
  const units = [];
  sortedDates.forEach((key) => {
    const idx = dayIndex(parseDateKey(key));
    const last = units[units.length - 1];
    if (last && idx - last.e === 1 && isTogether(key) && last.together) {
      last.e = idx;
      last.keys.push(key);
    } else {
      units.push({ s: idx, e: idx, keys: [key], together: isTogether(key), heavy: isHeavy(key) });
    }
  });
  return units;
}

// Cost of one person's units (sorted by start):
//   every two consecutive units: (even/gap)^3 + WEEK_GAP_PENALTY[weeks apart]
//   heavy units (weekends + chags) again on their own, including the stretch
//   from the start of the range and to its end (counted double).
function ownerCost(units, first, last, span) {
  let cost = 0;
  let sameWeek = 0;
  let weekAfterWeek = 0;
  let everyOtherWeek = 0;
  const gaps = [];
  const even = span / Math.max(1, units.length);
  for (let k = 1; k < units.length; k++) {
    const g = units[k].s - units[k - 1].e;
    gaps.push(g);
    cost += Math.pow(even / Math.max(1, g), 3);
    const w = weekNumber(units[k].s) - weekNumber(units[k - 1].e);
    if (w <= 0) sameWeek += 1;
    else if (w === 1) weekAfterWeek += 1;
    else if (w === 2) everyOtherWeek += 1;
    cost += WEEK_GAP_PENALTY[Math.max(0, w)] || 0;
  }
  const heavy = units.filter((u) => u.heavy);
  const heavyGaps = [];
  if (heavy.length) {
    const evenH = span / heavy.length;
    cost += Math.pow(evenH / Math.max(1, 2 * (heavy[0].s - first + 1)), 3);
    for (let k = 1; k < heavy.length; k++) {
      const g = heavy[k].s - heavy[k - 1].e;
      heavyGaps.push(g);
      cost += Math.pow(evenH / Math.max(1, g), 3);
    }
    cost += Math.pow(evenH / Math.max(1, 2 * (last - heavy[heavy.length - 1].e + 1)), 3);
  }
  return {
    cost,
    stats: {
      sameWeek,
      weekAfterWeek,
      everyOtherWeek,
      minGap: gaps.length ? Math.min(...gaps) : Infinity,
      avgGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : Infinity,
      maxGap: gaps.length ? Math.max(...gaps) : Infinity,
      heavyMinGap: heavyGaps.length ? Math.min(...heavyGaps) : Infinity,
    },
  };
}

/**
 * Improves a finished calendar by swapping whole units of the same kind
 * between people — a Thursday for a Thursday, an ordinary day for an ordinary
 * day, a weekend for a weekend, a chag share for a chag share of the same
 * length — whenever that lowers the spacing cost of the two people involved
 * (see ownerCost). Counts per kind never change. A swap is allowed only if
 * each person may take the new unit: no constraint on any of its days and no
 * other shift in its Sunday–Saturday week. The pairs are tried in a random
 * order (from `seed`), pass after pass, until a pass finds no improving swap.
 */
export function optimizeDistribution(assignments, ctx) {
  const {
    isTogether,
    isHeavy = isTogether,
    holidayKeys = new Set(),
    lockedDates = new Set(),
    ownerOf = (id) => id,
    isProtected = () => false,
    startDate,
    endDate,
    seed = 1,
    maxPasses = 60,
    swapChagShares = true,
    // simulated annealing before the final descent: `iterations` random swaps,
    // accepting a worse one with probability exp(-worse/T), T falling from t0
    // to t1. 0 iterations = plain descent only.
    iterations = 0,
    t0 = 60,
    t1 = 0.05,
    // allow a Thursday to be traded for an ordinary day, as long as nobody's
    // count of Thursdays or of ordinary days leaves the band the distribution
    // already has (min..max over everyone)
    crossWeekday = true,
    // allow moving one Thursday, ordinary day or weekend from one person to
    // another, as long as everyone's total and per-kind counts stay inside the
    // band the distribution already has (so the fairness spread never grows)
    giveUnits = true,
    giveShare = 0.3,
    // how much each person's spacing counts (see constraintWeight in
    // distributeShifts): a person whose own constraints squeeze their
    // calendar counts less, so the search never makes someone else's
    // spacing worse to make up for it
    weightOf = () => 1,
  } = ctx;
  const rand = makeRng(seed);
  const first = dayIndex(parseDateKey(startDate));
  const last = dayIndex(parseDateKey(endDate));
  const span = last - first + 1;
  const out = assignments.map((a) => ({ ...a }));
  const byDate = new Map(out.map((a) => [a.date, a]));

  // Build every person's units, and the movable ones with a swap kind.
  const owners = new Map(); // owner -> units[]
  const movable = [];
  const datesOf = new Map();
  out.forEach((a) => {
    const o = ownerOf(a.personId);
    if (!datesOf.has(o)) datesOf.set(o, []);
    datesOf.get(o).push(a.date);
  });
  datesOf.forEach((dates, o) => {
    const units = unitsOf(dates.sort(), isTogether, isHeavy);
    units.forEach((u) => {
      u.owner = o;
      u.person = byDate.get(u.keys[0]).personId;
      u.week = weekNumber(u.s);
      if (u.keys.some((k) => lockedDates.has(k))) return;
      if (!u.together) {
        const dow = parseDateKey(u.keys[0]).getDay();
        u.kind = dow === 4 ? "thu" : "reg";
      } else if (u.keys.some((k) => holidayKeys.has(k))) {
        if (!swapChagShares) return;
        // a chag share swaps only with a share of the same make-up (chag days
        // and plain weekend days), so nobody's per-kind counts change
        const h = u.keys.filter((k) => holidayKeys.has(k)).length;
        u.kind = `chag-${h}-${u.keys.length - h}`;
      } else if (u.keys.length === 2) {
        u.kind = "wkend";
      } else return;
      movable.push(u);
    });
    owners.set(o, units);
  });
  // Thursdays and ordinary days per owner, and the band (min..max) each count
  // may move in. Locked units count too.
  const kindCount = new Map();
  const isWeekend = (u) => u.together && u.keys.length === 2 && !u.keys.some((k) => holidayKeys.has(k));
  owners.forEach((units, o) => {
    const c = { thu: 0, reg: 0, wkend: 0, all: units.reduce((n, u) => n + u.keys.length, 0) }; // all = total days
    units.forEach((u) => {
      if (!u.together) c[parseDateKey(u.keys[0]).getDay() === 4 ? "thu" : "reg"] += 1;
      else if (isWeekend(u)) c.wkend += 1;
    });
    kindCount.set(o, c);
  });
  const bandOf = (k) => {
    const v = [...kindCount.values()].map((c) => c[k]);
    return [Math.min(...v), Math.max(...v)];
  };
  const band = { thu: bandOf("thu"), reg: bandOf("reg"), wkend: bandOf("wkend"), all: bandOf("all") };
  const inBand = (o, k, d) => {
    const n = kindCount.get(o)[k] + d;
    return n >= band[k][0] && n <= band[k][1];
  };

  // Does person o hold anything (other than exceptUnit) in the weeks of unit X?
  const weekBusy = (o, X, exceptUnit) => {
    const w0 = weekNumber(X.s);
    const w1 = weekNumber(X.e);
    return owners.get(o).some((u) => u !== exceptUnit && weekNumber(u.s) <= w1 && weekNumber(u.e) >= w0);
  };
  // Same-week and back-to-back penalties count in full for everyone; only the
  // rest (one-week gaps and short gaps) is weighted by weightOf.
  const costOf = (o, units) => {
    const { cost: c, stats } = ownerCost(units, first, last, span);
    const hard = WEEK_GAP_PENALTY[0] * stats.sameWeek + WEEK_GAP_PENALTY[1] * stats.weekAfterWeek;
    return hard + weightOf(o) * (c - hard);
  };
  const cost = new Map([...owners].map(([o, units]) => [o, costOf(o, units)]));
  const replaced = (units, remove, add) => {
    const list = units.filter((u) => u !== remove);
    list.push(add);
    list.sort((x, y) => x.s - y.s);
    return list;
  };
  const costBefore = [...cost.values()].reduce((a, b) => a + b, 0);

  // candidate pairs, grouped by kind, in random order
  const byKind = new Map();
  movable.forEach((u) => {
    if (!byKind.has(u.kind)) byKind.set(u.kind, []);
    byKind.get(u.kind).push(u);
  });
  const pairs = [];
  byKind.forEach((list) => {
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) pairs.push([list[x], list[y]]);
  });
  if (crossWeekday) {
    const thu = byKind.get("thu") || [];
    const reg = byKind.get("reg") || [];
    thu.forEach((A) => reg.forEach((B) => pairs.push([A, B])));
  }
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }

  let swaps = 0;
  let passes = 0;
  const moved = new Set();
  // Try swapping units A and B; apply it if accept(delta) says so.
  const trySwap = (A, B, accept) => {
    const u = A.owner;
    const v = B.owner;
    if (u === v) return false;
    const cross = A.kind !== B.kind;
    // u gives A and gets B; v gives B and gets A
    if (cross && !(inBand(u, A.kind, -1) && inBand(u, B.kind, +1) && inBand(v, B.kind, -1) && inBand(v, A.kind, +1))) return false;
    if (B.keys.some((k) => isProtected(A.person, k)) || A.keys.some((k) => isProtected(B.person, k))) return false;
    if (weekBusy(u, B, A) || weekBusy(v, A, B)) return false;
    // the units trade places: A's days go to v, B's days to u
    const newA = { ...A, owner: v, person: B.person };
    const newB = { ...B, owner: u, person: A.person };
    const listU = replaced(owners.get(u), A, newB);
    const listV = replaced(owners.get(v), B, newA);
    const cu = costOf(u, listU);
    const cv = costOf(v, listV);
    const delta = cu + cv - cost.get(u) - cost.get(v);
    if (!accept(delta)) return false;
    A.keys.forEach((k) => { byDate.get(k).personId = newA.person; moved.add(k); });
    B.keys.forEach((k) => { byDate.get(k).personId = newB.person; moved.add(k); });
    // keep the pair objects pointing at the live units
    Object.assign(A, newA);
    Object.assign(B, newB);
    owners.set(u, listU.map((x) => (x === newB ? B : x)));
    owners.set(v, listV.map((x) => (x === newA ? A : x)));
    cost.set(u, cu);
    cost.set(v, cv);
    if (cross) {
      kindCount.get(u)[A.kind] -= 1;
      kindCount.get(u)[B.kind] += 1;
      kindCount.get(v)[B.kind] -= 1;
      kindCount.get(v)[A.kind] += 1;
    }
    swaps += 1;
    return true;
  };
  // Move unit A from its owner u to person v (no unit back).
  const ownerList = [...owners.keys()];
  const givable = movable.filter((A) => A.kind === "thu" || A.kind === "reg" || A.kind === "wkend");
  const personOf = new Map();
  owners.forEach((units, o) => { if (units.length) personOf.set(o, units[0].person); });
  const tryGive = (A, v, accept) => {
    const u = A.owner;
    if (u === v || !personOf.has(v)) return false;
    const d = A.keys.length;
    if (!(inBand(u, A.kind, -1) && inBand(u, "all", -d) && inBand(v, A.kind, +1) && inBand(v, "all", +d))) return false;
    const pv = personOf.get(v);
    if (A.keys.some((k) => isProtected(pv, k))) return false;
    if (weekBusy(v, A, null)) return false;
    const newA = { ...A, owner: v, person: pv };
    const listU = owners.get(u).filter((x) => x !== A);
    const listV = replaced(owners.get(v), null, newA);
    const cu = costOf(u, listU);
    const cv = costOf(v, listV);
    const delta = cu + cv - cost.get(u) - cost.get(v);
    if (!accept(delta)) return false;
    A.keys.forEach((k) => { byDate.get(k).personId = pv; moved.add(k); });
    Object.assign(A, newA);
    owners.set(u, listU);
    owners.set(v, listV.map((x) => (x === newA ? A : x)));
    cost.set(u, cu);
    cost.set(v, cv);
    for (const [o, sg] of [[u, -1], [v, +1]]) { kindCount.get(o)[A.kind] += sg; kindCount.get(o).all += sg * A.keys.length; }
    swaps += 1;
    return true;
  };
  const doGive = giveUnits && givable.length > 0 && ownerList.length > 1;

  if (iterations > 0 && pairs.length > 0) {
    for (let it = 0; it < iterations; it++) {
      const T = t0 * Math.pow(t1 / t0, it / iterations);
      const accept = (d) => d < -1e-9 || rand() < Math.exp(-d / T);
      if (doGive && rand() < giveShare) {
        tryGive(givable[Math.floor(rand() * givable.length)], ownerList[Math.floor(rand() * ownerList.length)], accept);
        continue;
      }
      const [A, B] = pairs[Math.floor(rand() * pairs.length)];
      trySwap(A, B, accept);
    }
  }
  for (; passes < maxPasses; passes++) {
    let improved = false;
    for (const [A, B] of pairs) {
      if (trySwap(A, B, (d) => d < -1e-9)) improved = true;
    }
    if (doGive) for (const A of givable) for (const v of ownerList) if (tryGive(A, v, (d) => d < -1e-9)) improved = true;
    if (!improved) { passes += 1; break; }
  }
  const costAfter = [...cost.values()].reduce((a, b) => a + b, 0);
  return { assignments: out, stats: { passes, swaps, costBefore, costAfter, moved } };
}

export function compareRuns(a, b) {
  return (
    a.empty - b.empty ||
    a.sameWeek - b.sameWeek ||
    a.weekAfterWeek - b.weekAfterWeek ||
    a.everyOtherWeek - b.everyOtherWeek ||
    b.worstMinGap - a.worstMinGap ||
    b.avgMinGap - a.avgMinGap ||
    a.cost - b.cost
  );
}