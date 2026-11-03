// Post-pass that optimises the SPACING of the greedy distribution.
//
// The greedy pass in shiftDistributionAlgorithm.js fills the range day by day
// with spacing as a soft tiebreaker, so a person can end up with two weekends
// (or two chag shares) in consecutive weeks: every single decision looks fine
// in isolation, the year as a whole does not. This module keeps the greedy
// result as a feasible seed and then improves it explicitly, iterating a few
// times over the four kinds of day, by MOVING a whole block (a Fri+Sat weekend,
// a chag share, a single day) to someone else or SWAPPING it with another
// person's block of the same kind.
//
// Every block moves as one unit, so togetherness (rules b/c) is never broken,
// and the constraints the greedy pass must satisfy stay hard here too:
//   - a person is never given a block on a date they set an אילוץ for,
//   - nobody holds two blocks within the same Sun-Sat week,
//   - a move never makes the receiver richer than the sender (rule e),
//   - a swap exchanges blocks of the same kind and size, so counts don't move.
//
// The objective is the gap between a person's blocks OF THE SAME KIND: for each
// kind, the fair gap is range length / how many blocks per person that kind
// yields, and any gap shorter than that costs ((fair - gap) / fair)^2, summed
// over the person's kind pairs, then weighted per kind and added up.

const PASSES = 3;
// Ignore an improvement smaller than this (keeps the search from churning).
const MIN_GAIN = 0.002;
// A pass that improves the total by less than this fraction is the last one.
const STOP_RATIO = 0.02;
// Swap partners considered per block (the ones furthest away are the useful ones).
const MAX_SWAPS = 12;

const GROUPS = ["holidays", "weekends", "hard", "thursdays", "regular", "any"];

// Chags and weekends matter most (they are the "big shifts"), the combined
// burden a little less (it already contains them), Thursdays and ordinary days
// least, and the whole-year view is a soft backstop. Weights were tuned on a
// full 2028 range: raising chags above weekends is what keeps the chag gaps
// from being traded away to improve the weekend/year ones.
const GROUP_WEIGHT = {
  holidays: 3,
  weekends: 2,
  hard: 0.5,
  thursdays: 0.5,
  regular: 0.25,
  any: 0.2,
};

// Which spacing groups a block of this kind belongs to.
const groupsOf = (category) => {
  if (category === "holidays") return ["holidays", "hard", "any"];
  if (category === "weekends") return ["weekends", "hard", "any"];
  if (category === "thursdays") return ["thursdays", "any"];
  return ["regular", "any"];
};

const parseKey = (key) => new Date(`${String(key).slice(0, 10)}T00:00:00`);

const dayIndex = (date) =>
  Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);

const emptyGroups = () => ({ holidays: [], weekends: [], hard: [], thursdays: [], regular: [], any: [] });

// Sorted insert — the per-person lists are tiny, but they are rebuilt for every
// candidate move, so they stay sorted instead of being re-sorted each time.
const insertAnchor = (arr, value) => {
  let at = 0;
  while (at < arr.length && arr[at] < value) at += 1;
  const next = arr.slice();
  next.splice(at, 0, value);
  return next;
};

const penaltyOf = (byGroup, targets, weights) => {
  let total = 0;
  for (const group of GROUPS) {
    const arr = byGroup[group];
    const target = targets[group];
    if (!arr || !(target > 0) || arr.length < 2) continue;
    for (let i = 1; i < arr.length; i += 1) {
      const gap = arr[i] - arr[i - 1];
      if (gap < target) {
        const shortfall = (target - gap) / target;
        total += weights[group] * shortfall * shortfall;
      }
    }
  }
  return total;
};

const groupsWithout = (byGroup, unit) => {
  const next = { ...byGroup };
  groupsOf(unit.category).forEach((group) => {
    next[group] = (byGroup[group] || []).filter((value) => value !== unit.anchor);
  });
  return next;
};

const groupsWith = (byGroup, unit) => {
  const next = { ...byGroup };
  groupsOf(unit.category).forEach((group) => {
    next[group] = insertAnchor(byGroup[group] || [], unit.anchor);
  });
  return next;
};

/**
 * Turns one assignment block per person into one unit: consecutive assigned
 * days of a togetherness bundle (Fri+Sat, or a chag share) held by the same
 * person, or a single ordinary/Thursday day.
 */
function buildUnits(bundles, assignmentByDate, holidayByDate) {
  const units = [];
  (bundles || []).forEach((bundle) => {
    const hasHoliday = (bundle.days || []).some((day) => holidayByDate.has(day.key));
    const pool = hasHoliday ? "user" : "group";
    let current = null;
    (bundle.days || []).forEach((day) => {
      const assignment = assignmentByDate.get(day.key);
      if (!assignment) {
        current = null;
        return;
      }
      const index = dayIndex(day.date);
      if (
        current &&
        current.personId === assignment.personId &&
        index - current.lastIndex === 1
      ) {
        current.keys.add(day.key);
        current.weeks.add(day.weekKey);
        current.size += 1;
        current.lastIndex = index;
        return;
      }
      const category = hasHoliday
        ? "holidays"
        : day.date.getDay() === 5 || day.date.getDay() === 6
          ? "weekends"
          : day.date.getDay() === 4
            ? "thursdays"
            : "regular";
      current = {
        personId: assignment.personId,
        pool,
        category,
        anchor: index,
        lastIndex: index,
        size: 1,
        keys: new Set([day.key]),
        weeks: new Set([day.weekKey]),
      };
      units.push(current);
    });
  });
  return units;
}

/**
 * Refines the spacing of a finished distribution.
 *
 * @param {Array<{date: string, personId: number}>} assignments - the greedy result
 * @param {Object} options
 * @param {Array<{kind: string, days: Array}>} options.bundles - same bundles the greedy pass built
 * @param {Array} options.people - the group pool
 * @param {Array} options.holidayPool - the per-user chag pool
 * @param {Set<string>} options.holidayByDate - chag / erev / Chol HaMoed dates
 * @param {Map<number, Set<string>>} options.protectedDates - constraints of the group pool
 * @param {Map<number, Set<string>>} options.holidayProtectedDates - constraints of the chag pool
 * @param {string} options.startDate - 'yyyy-MM-dd'
 * @param {string} options.endDate - 'yyyy-MM-dd'
 * @returns {{assignments: Array<{date: string, personId: number}>, stats: Object}}
 */
export function refineSpacing(assignments, options = {}) {
  const {
    bundles = [],
    people = [],
    holidayPool = [],
    holidayByDate = new Set(),
    protectedDates = new Map(),
    holidayProtectedDates = new Map(),
    startDate,
    endDate,
  } = options;
  const weights = GROUP_WEIGHT;

  const assignmentByDate = new Map(
    (assignments || []).map((a) => [a.date, { date: a.date, personId: a.personId }]),
  );
  const units = buildUnits(bundles, assignmentByDate, holidayByDate);

  const startIndex = dayIndex(parseKey(startDate));
  const endIndex = dayIndex(parseKey(endDate));
  const rangeDays = Math.max(1, endIndex - startIndex + 1);

  const poolIds = {
    user: new Set((holidayPool || []).map((p) => p.serial_id)),
    group: new Set((people || []).map((p) => p.serial_id)),
  };
  const everyone = new Set([...poolIds.user, ...poolIds.group]);

  // Fair gap per kind: how many blocks of that kind each person should have,
  // and from that the average number of days between two of them.
  const totals = { holidays: 0, weekends: 0, thursdays: 0, regular: 0, hard: 0, any: 0 };
  units.forEach((unit) => groupsOf(unit.category).forEach((group) => (totals[group] += 1)));
  const poolSize = {
    holidays: poolIds.user.size,
    weekends: poolIds.group.size,
    thursdays: poolIds.group.size,
    regular: poolIds.group.size,
    hard: everyone.size,
    any: everyone.size,
  };
  const targets = {};
  GROUPS.forEach((group) => {
    const perPerson = totals[group] / Math.max(1, poolSize[group] || 1);
    targets[group] = perPerson > 0 ? Math.min(rangeDays, rangeDays / perPerson) : 0;
  });

  const groupsByPerson = new Map();
  const unitsByPerson = new Map();
  const costCache = new Map();
  const dayCounts = new Map();
  const kindCounts = new Map();

  const costOf = (personId) => {
    if (costCache.has(personId)) return costCache.get(personId);
    const value = penaltyOf(groupsByPerson.get(personId) || emptyGroups(), targets, weights);
    costCache.set(personId, value);
    return value;
  };

  const addUnit = (unit) => {
    const personId = unit.personId;
    if (!groupsByPerson.has(personId)) groupsByPerson.set(personId, emptyGroups());
    const byGroup = groupsByPerson.get(personId);
    groupsOf(unit.category).forEach((group) => {
      byGroup[group] = insertAnchor(byGroup[group], unit.anchor);
    });
    costCache.delete(personId);
  };

  const removeUnit = (unit) => {
    const personId = unit.personId;
    const byGroup = groupsByPerson.get(personId);
    if (!byGroup) return;
    groupsOf(unit.category).forEach((group) => {
      byGroup[group] = byGroup[group].filter((value) => value !== unit.anchor);
    });
    costCache.delete(personId);
  };

  const refreshCounts = (personId) => {
    let days = 0;
    const kinds = {};
    (unitsByPerson.get(personId) || []).forEach((unit) => {
      days += unit.size;
      kinds[unit.category] = (kinds[unit.category] || 0) + unit.size;
    });
    dayCounts.set(personId, days);
    kindCounts.set(personId, kinds);
    costCache.delete(personId);
  };

  units.forEach((unit) => {
    addUnit(unit);
    if (!unitsByPerson.has(unit.personId)) unitsByPerson.set(unit.personId, []);
    unitsByPerson.get(unit.personId).push(unit);
  });
  everyone.forEach((personId) => refreshCounts(personId));

  const daysOf = (personId) => dayCounts.get(personId) || 0;
  const daysOfKind = (personId, category) => (kindCounts.get(personId) || {})[category] || 0;

  const weeksOf = (personId, excludeUnit) => {
    const weeks = new Set();
    (unitsByPerson.get(personId) || []).forEach((unit) => {
      if (unit === excludeUnit) return;
      unit.weeks.forEach((week) => weeks.add(week));
    });
    return weeks;
  };

  const isFree = (personId, keys) => {
    const raw = protectedDates.get(personId);
    const chag = holidayProtectedDates.get(personId);
    for (const key of keys) {
      if (raw?.has(key) || chag?.has(key)) return false;
    }
    return true;
  };

  const weeksFree = (personId, weeks, excludeUnit) => {
    const taken = weeksOf(personId, excludeUnit);
    for (const week of weeks) if (taken.has(week)) return false;
    return true;
  };

  const moveUnit = (unit, personId) => {
    const from = unit.personId;
    removeUnit(unit);
    unitsByPerson.set(from, (unitsByPerson.get(from) || []).filter((u) => u !== unit));
    unit.personId = personId;
    addUnit(unit);
    if (!unitsByPerson.has(personId)) unitsByPerson.set(personId, []);
    unitsByPerson.get(personId).push(unit);
    unit.keys.forEach((key) => {
      const assignment = assignmentByDate.get(key);
      if (assignment) assignment.personId = personId;
    });
    refreshCounts(from);
    refreshCounts(personId);
  };

  const swapUnits = (unit, other) => {
    const a = unit.personId;
    const b = other.personId;
    removeUnit(unit);
    removeUnit(other);
    unitsByPerson.set(a, (unitsByPerson.get(a) || []).filter((u) => u !== unit).concat([other]));
    unitsByPerson.set(b, (unitsByPerson.get(b) || []).filter((u) => u !== other).concat([unit]));
    unit.personId = b;
    other.personId = a;
    addUnit(unit);
    addUnit(other);
    unit.keys.forEach((key) => {
      const assignment = assignmentByDate.get(key);
      if (assignment) assignment.personId = b;
    });
    other.keys.forEach((key) => {
      const assignment = assignmentByDate.get(key);
      if (assignment) assignment.personId = a;
    });
    refreshCounts(a);
    refreshCounts(b);
  };

  // The best single change for one block: move it, or swap it with a same-kind
  // block of the same size held by someone else. The one with the largest cost
  // drop wins, and it is applied immediately so the rest of the pass sees it.
  const bestChangeFor = (unit) => {
    const from = unit.personId;
    const fromBase = costOf(from);
    const fromAfter = penaltyOf(
      groupsWithout(groupsByPerson.get(from) || emptyGroups(), unit),
      targets,
      weights,
    );
    const fromDays = daysOf(from);
    const fromKindDays = daysOfKind(from, unit.category);
    const fromGroups = groupsByPerson.get(from) || emptyGroups();

    let best = null;

    poolIds[unit.pool].forEach((candidate) => {
      if (candidate === from) return;
      if (daysOf(candidate) + unit.size > fromDays) return;
      if (daysOfKind(candidate, unit.category) + unit.size > fromKindDays) return;
      if (!isFree(candidate, unit.keys)) return;
      if (!weeksFree(candidate, unit.weeks, null)) return;
      const delta =
        fromAfter +
        penaltyOf(
          groupsWith(groupsByPerson.get(candidate) || emptyGroups(), unit),
          targets,
          weights,
        ) -
        fromBase -
        costOf(candidate);
      if (delta < -MIN_GAIN && (!best || delta < best.delta)) {
        best = { kind: "move", delta, personId: candidate };
      }
    });

    // Swaps exchange blocks of the same kind and size, so no count moves and
    // rule (e) can't be broken — this is how a badly placed block trades places
    // with a well-placed one further down the year.
    const partners = units
      .filter(
        (other) =>
          other !== unit &&
          other.pool === unit.pool &&
          other.category === unit.category &&
          other.size === unit.size,
      )
      .map((other) => ({ other, distance: Math.abs(other.anchor - unit.anchor) }))
      .filter((entry) => entry.distance > 0)
      .sort((a, b) => b.distance - a.distance)
      .slice(0, MAX_SWAPS);

    partners.forEach(({ other }) => {
      const mate = other.personId;
      if (mate === from) return;
      if (!isFree(mate, unit.keys) || !isFree(from, other.keys)) return;
      if (!weeksFree(mate, unit.weeks, other)) return;
      if (!weeksFree(from, other.weeks, unit)) return;
      const delta =
        penaltyOf(groupsWith(groupsWithout(fromGroups, unit), other), targets, weights) +
        penaltyOf(
          groupsWith(groupsWithout(groupsByPerson.get(mate) || emptyGroups(), other), unit),
          targets,
          weights,
        ) -
        fromBase -
        costOf(mate);
      if (delta < -MIN_GAIN && (!best || delta < best.delta)) {
        best = { kind: "swap", delta, other };
      }
    });

    return best;
  };

  const totalCost = () => {
    let sum = 0;
    everyone.forEach((personId) => (sum += costOf(personId)));
    return sum;
  };

  const initialCost = totalCost();
  const stats = { initialCost, finalCost: initialCost, passes: 0, moves: 0, swaps: 0 };

  for (let pass = 0; pass < PASSES; pass += 1) {
    const before = totalCost();
    // Worst-off people first: they own the blocks that need moving.
    const actors = [...everyone].sort((a, b) => costOf(b) - costOf(a));
    actors.forEach((personId) => {
      [...(unitsByPerson.get(personId) || [])].forEach((unit) => {
        if (unit.personId !== personId) return; // already swapped away in this pass
        const change = bestChangeFor(unit);
        if (!change) return;
        if (change.kind === "move") {
          moveUnit(unit, change.personId);
          stats.moves += 1;
        } else {
          swapUnits(unit, change.other);
          stats.swaps += 1;
        }
      });
    });
    const after = totalCost();
    stats.passes = pass + 1;
    if (after <= 0 || before - after < Math.max(0.05, before * STOP_RATIO)) break;
  }

  stats.finalCost = totalCost();
  stats.initialCost = Math.round(initialCost * 1000) / 1000;
  stats.finalCost = Math.round(stats.finalCost * 1000) / 1000;

  return {
    assignments: [...assignmentByDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    stats,
  };
}