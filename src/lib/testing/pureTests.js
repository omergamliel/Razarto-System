import { addDays, addHours, format, startOfWeek } from "date-fns";
import {
  resolveSwapType,
  subtractSegments,
  computeCoverageSummary,
} from "@/components/calendar/whatsappTemplates";
import { distributeShifts } from "@/components/calendar/shiftDistributionAlgorithm";
import { assert, assertEqual } from "./assert";

// No backend I/O in this file — every test here is a plain function call
// against already-exported, already-pure helpers.

function testResolveSwapType() {
  assertEqual(
    resolveSwapType({ start_time: "09:00", end_time: "09:00" }, null),
    "full",
    "matching start/end times should infer a full shift",
  );
  assertEqual(
    resolveSwapType({ start_time: "09:00", end_time: "17:00" }, null),
    "partial",
    "mismatched start/end times should infer a partial shift",
  );
  assertEqual(
    resolveSwapType(
      { start_time: "09:00", end_time: "17:00" },
      { request_type: "Full" },
    ),
    "full",
    "an explicit request_type should override the inferred type",
  );
  assertEqual(
    resolveSwapType({}, { request_type: "Partial" }),
    "partial",
    "an explicit Partial request_type should be honored",
  );
}

function testSubtractSegments() {
  const rangeStart = new Date("2999-01-06T09:00:00");
  const rangeEnd = new Date("2999-01-06T18:00:00");

  const fullOverlap = subtractSegments(rangeStart, rangeEnd, [
    { start: rangeStart, end: rangeEnd },
  ]);
  assertEqual(fullOverlap.length, 0, "full overlap should leave no gaps");

  const noOverlap = subtractSegments(rangeStart, rangeEnd, [
    { start: rangeEnd, end: addHours(rangeEnd, 2) },
  ]);
  assertEqual(noOverlap.length, 1, "no overlap should leave the range untouched");
  assertEqual(
    noOverlap[0].start.getTime(),
    rangeStart.getTime(),
    "untouched gap should keep the original start",
  );
  assertEqual(
    noOverlap[0].end.getTime(),
    rangeEnd.getTime(),
    "untouched gap should keep the original end",
  );

  const middleSegment = {
    start: addHours(rangeStart, 3),
    end: addHours(rangeStart, 6),
  };
  const partialOverlap = subtractSegments(rangeStart, rangeEnd, [middleSegment]);
  assertEqual(
    partialOverlap.length,
    2,
    "a segment covering the middle should leave a gap on each side",
  );
  assertEqual(
    partialOverlap[0].end.getTime(),
    middleSegment.start.getTime(),
    "first remaining gap should end where the covering segment starts",
  );
  assertEqual(
    partialOverlap[1].start.getTime(),
    middleSegment.end.getTime(),
    "second remaining gap should start where the covering segment ends",
  );

  const touching = subtractSegments(rangeStart, rangeEnd, [
    { start: addHours(rangeStart, -1), end: rangeStart },
  ]);
  assertEqual(
    touching.length,
    1,
    "a segment that only touches the boundary should not create a phantom gap",
  );
  assertEqual(
    touching[0].start.getTime(),
    rangeStart.getTime(),
    "touching-boundary case should leave the range exactly as it was",
  );
}

function testComputeCoverageSummary() {
  const shift = {
    id: "pure-test-shift",
    start_date: "2999-01-06",
    end_date: "2999-01-06",
    start_time: "09:00",
    end_time: "09:00",
  };
  const activeRequest = {
    request_type: "Partial",
    req_start_date: "2999-01-06",
    req_end_date: "2999-01-06",
    req_start_time: "12:00",
    req_end_time: "18:00",
  };

  const fullyCovered = computeCoverageSummary({
    shift,
    activeRequest,
    coverages: [
      {
        status: "Approved",
        cover_start_date: "2999-01-06",
        cover_start_time: "12:00",
        cover_end_date: "2999-01-06",
        cover_end_time: "18:00",
      },
    ],
  });
  assertEqual(
    fullyCovered.missingSegments.length,
    0,
    "coverage spanning the whole requested window should leave no missing segments",
  );
  assert(fullyCovered.isFullyCovered, "should report isFullyCovered = true");

  const partiallyCovered = computeCoverageSummary({
    shift,
    activeRequest,
    coverages: [
      {
        status: "Approved",
        cover_start_date: "2999-01-06",
        cover_start_time: "12:00",
        cover_end_date: "2999-01-06",
        cover_end_time: "15:00",
      },
    ],
  });
  assertEqual(
    partiallyCovered.missingSegments.length,
    1,
    "covering only part of the window should leave exactly one missing segment",
  );
  assertEqual(
    format(partiallyCovered.missingSegments[0].start, "HH:mm"),
    "15:00",
    "the missing segment should start where the partial coverage ends",
  );
  assertEqual(
    format(partiallyCovered.missingSegments[0].end, "HH:mm"),
    "18:00",
    "the missing segment should end at the requested window's end",
  );
  assert(
    !partiallyCovered.isFullyCovered,
    "should report isFullyCovered = false while a gap remains",
  );
}

// Property-based rather than exact-sequence assertions: these check
// invariants distributeShifts must uphold regardless of internal
// tie-breaking order, so the test doesn't need to hand-predict every
// assignment.
function testDistributeShifts() {
  const people = [
    { serial_id: 1, full_name: "A" },
    { serial_id: 2, full_name: "B" },
  ];
  const anchor = startOfWeek(new Date(), { weekStartsOn: 0 });
  const startDate = format(anchor, "yyyy-MM-dd");
  const endDate = format(addDays(anchor, 13), "yyyy-MM-dd"); // 2 full Sun-Sat weeks

  const { assignments, skipped } = distributeShifts({
    people,
    existingShifts: [],
    startDate,
    endDate,
  });

  // Weekly cap: no person may get more than WEEKLY_CAP=2 *regular*
  // (non Fri/Sat) assignments within the same Sun-Sat week. Weekend
  // "togetherness" bundles are allowed to exceed this by design (rule
  // b/c overrides rule a), so they're excluded from this check.
  const regularCountByPersonWeek = new Map();
  assignments.forEach(({ date, personId }) => {
    const d = new Date(date);
    const dow = d.getDay();
    if (dow === 5 || dow === 6) return;
    const weekKey = format(startOfWeek(d, { weekStartsOn: 0 }), "yyyy-MM-dd");
    const key = `${personId}|${weekKey}`;
    regularCountByPersonWeek.set(key, (regularCountByPersonWeek.get(key) || 0) + 1);
  });
  regularCountByPersonWeek.forEach((count, key) => {
    assert(count <= 2, `weekly cap exceeded for ${key}: ${count} regular-day assignments`);
  });

  // Togetherness: whenever both Friday and Saturday of a week were
  // assigned, they must go to the same person.
  const byDate = new Map(assignments.map((a) => [a.date, a.personId]));
  for (let i = 0; i < 2; i += 1) {
    const friday = format(addDays(anchor, i * 7 + 5), "yyyy-MM-dd");
    const saturday = format(addDays(anchor, i * 7 + 6), "yyyy-MM-dd");
    if (byDate.has(friday) && byDate.has(saturday)) {
      assertEqual(
        byDate.get(saturday),
        byDate.get(friday),
        `Friday (${friday}) and Saturday (${saturday}) should go to the same person`,
      );
    }
  }

  assertEqual(
    assignments.length + skipped.length,
    14,
    "every day in the range should be either assigned or explicitly skipped",
  );

  // Existing shifts are never touched.
  const preAssignedDate = format(addDays(anchor, 1), "yyyy-MM-dd");
  const { assignments: withExisting } = distributeShifts({
    people,
    existingShifts: [{ original_user_id: 1, start_date: preAssignedDate }],
    startDate,
    endDate,
  });
  assert(
    !withExisting.some((a) => a.date === preAssignedDate),
    "a day that already has a shift in range should never be reassigned",
  );

  // No eligible people: everything is skipped, nothing is assigned.
  const emptyResult = distributeShifts({
    people: [],
    existingShifts: [],
    startDate,
    endDate: format(addDays(anchor, 2), "yyyy-MM-dd"),
  });
  assertEqual(emptyResult.assignments.length, 0, "no people means no assignments");
  assertEqual(emptyResult.skipped.length, 3, "every day should be skipped with no eligible people");
}

export const pureTests = [
  {
    id: "pure-resolve-swap-type",
    name: "resolveSwapType: full vs. partial detection",
    category: "pure",
    run: testResolveSwapType,
  },
  {
    id: "pure-subtract-segments",
    name: "subtractSegments: overlap/gap math",
    category: "pure",
    run: testSubtractSegments,
  },
  {
    id: "pure-compute-coverage-summary",
    name: "computeCoverageSummary: missing segments",
    category: "pure",
    run: testComputeCoverageSummary,
  },
  {
    id: "pure-distribute-shifts",
    name: "distributeShifts: weekly cap, togetherness, no-touch, empty-people",
    category: "pure",
    run: testDistributeShifts,
  },
];
