import { addDays, addHours, format, startOfWeek } from "date-fns";
import {
  resolveSwapType,
  subtractSegments,
  computeCoverageSummary,
} from "@/components/calendar/whatsappTemplates";
import { distributeShifts } from "@/components/calendar/shiftDistributionAlgorithm";
import { computeNotificationEvents } from "@/components/sidebar/notificationEvents";
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

function testComputeNotificationEvents() {
  const me = { serial_id: 1, full_name: "Me", email: "me@x.com" };
  const allUsers = [
    me,
    { serial_id: 2, full_name: "Alice", email: "alice@x.com" },
    { serial_id: 3, full_name: "Bob", email: "bob@x.com" },
  ];

  const shifts = [
    { id: "s1", original_user_id: 1, status: "Active", start_date: "2999-01-06" },
    { id: "s2", original_user_id: 2, status: "Active", start_date: "2999-01-07" },
    { id: "s3", original_user_id: 1, status: "Active", start_date: "2999-01-08" },
    { id: "s4", original_user_id: 1, status: "Active", start_date: "2999-01-09" },
    // Ownership already transferred to Bob (3) — simulates a closed General
    // request having reassigned it away from me.
    { id: "s5", original_user_id: 3, status: "Active", start_date: "2999-01-10" },
  ];

  const swapRequests = [
    // #1: Alice's Head2Head request targets my shift (s1).
    {
      id: "r1",
      request_type: "Head2Head",
      status: "Open",
      requesting_user_id: 2,
      shift_ids: ["s2"],
      offered_shift_ids: ["s1"],
    },
    // Backs coverage-new (c1) below: my own open Partial request.
    {
      id: "r2",
      request_type: "Partial",
      status: "Open",
      requesting_user_id: 1,
      shift_ids: ["s3"],
    },
    // Backs coverage-cancelled (c2) below.
    {
      id: "r3",
      request_type: "Full",
      status: "Partially_Covered",
      requesting_user_id: 1,
      shift_ids: ["s4"],
    },
    // #4: my General request, now closed — s5 already reassigned to Bob.
    {
      id: "r4",
      request_type: "General",
      status: "Closed",
      requesting_user_id: 1,
      shift_ids: ["s5"],
      offered_shift_ids: [],
    },
    // #5: Alice's request, closed, which I helped cover (see c3 below).
    {
      id: "r5",
      request_type: "Partial",
      status: "Closed",
      requesting_user_id: 2,
      shift_ids: ["s2"],
    },
    // Negative: my own outgoing Head2Head request should never self-notify.
    {
      id: "r6",
      request_type: "Head2Head",
      status: "Open",
      requesting_user_id: 1,
      shift_ids: ["s1"],
      offered_shift_ids: ["s2"],
    },
  ];

  const coverages = [
    // #2: Bob offers to cover part of my open Partial request (r2/s3).
    { id: "c1", shift_id: "s3", covering_user_id: 3, status: "Pending", request_id: "r2" },
    // #3: Bob cancels a coverage on my shift (r3/s4).
    { id: "c2", shift_id: "s4", covering_user_id: 3, status: "Cancelled", request_id: "r3" },
    // #5 backing: I cover part of Alice's request (r5/s2).
    { id: "c3", shift_id: "s2", covering_user_id: 1, status: "Approved", request_id: "r5" },
    // Negative: a coverage row where I'm both the shift owner and coverer
    // should never fire — can't happen in real data, but the guard should
    // hold regardless.
    { id: "c4", shift_id: "s1", covering_user_id: 1, status: "Pending", request_id: "r6" },
  ];

  const events = computeNotificationEvents({ me, shifts, swapRequests, coverages, allUsers });
  const fingerprints = events.map((e) => e.fingerprint);
  const has = (fp) => fingerprints.includes(fp);

  assert(has("h2h-incoming:r1"), "incoming Head2Head request should notify me");
  assert(has("coverage-new:c1"), "a new coverage offer on my shift should notify me");
  assert(has("coverage-cancelled:c2"), "a cancelled coverage on my shift should notify me");
  assert(has("sr-closed:r4"), "my closed General request should notify me");
  assert(has("sr-closed-covered-by-me:r5"), "a closed request I helped cover should notify me");

  assert(!has("h2h-incoming:r6"), "my own outgoing Head2Head request should not self-notify");
  assert(!has("coverage-new:c4"), "a coverage where I'm both owner and coverer should not notify");
  assert(!has("coverage-cancelled:c4"), "c4 is Pending, not Cancelled — should not fire the cancelled event");

  const closedEvent = events.find((e) => e.fingerprint === "sr-closed:r4");
  assert(
    closedEvent.body.includes("Bob"),
    "the closed-request event should name the new owner once ownership actually transferred",
  );

  const coverageEvent = events.find((e) => e.fingerprint === "coverage-new:c1");
  assertEqual(
    coverageEvent.actionTarget,
    "kpi:partial_gaps:mine",
    "a coverage offer on a Partial request should deep-link to the partial-gaps 'mine' tab",
  );

  // Fingerprint stability: identical input must yield an identical fingerprint
  // set (this is what useNotificationScanner's localStorage dedupe relies on).
  const secondRun = computeNotificationEvents({ me, shifts, swapRequests, coverages, allUsers });
  assertEqual(
    JSON.stringify([...fingerprints].sort()),
    JSON.stringify([...secondRun.map((e) => e.fingerprint)].sort()),
    "re-running with identical input should produce an identical fingerprint set",
  );
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
  {
    id: "pure-compute-notification-events",
    name: "computeNotificationEvents: relevant-to-me detection + fingerprint stability",
    category: "pure",
    run: testComputeNotificationEvents,
  },
];
