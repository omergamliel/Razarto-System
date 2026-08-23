import { addDays, addHours, format, startOfWeek } from "date-fns";
import {
  resolveSwapType,
  subtractSegments,
  computeCoverageSummary,
  resolveOwnerId,
} from "@/components/calendar/whatsappTemplates";
import { distributeShifts } from "@/components/calendar/shiftDistributionAlgorithm";
import { computeNotificationEvents } from "@/components/sidebar/notificationEvents";
import {
  deriveShiftActionFlags,
  deriveRequestItemButtons,
  filterRequestsForSwapTab,
  filterPartialGapsForTab,
  isActiveGroupMember,
} from "@/lib/utils";
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
        type: "cover",
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
        type: "cover",
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

// Ownership after Phase 4: the base "assignment" ShiftCoverage row is the
// source of truth for who owns a slot, and "who works window W" is a cover row
// overlapping W if one exists, else the assignment owner. Cover rows never
// change ownership; only the assignment row does.
function testResolveOwnership() {
  const shift = {
    id: "s1",
    start_date: "2999-01-06",
    end_date: "2999-01-06",
    start_time: "09:00",
    end_time: "18:00",
  };
  const activeRequest = {
    request_type: "Partial",
    req_start_date: "2999-01-06",
    req_end_date: "2999-01-06",
    req_start_time: "12:00",
    req_end_time: "18:00",
  };

  // The assignment row's covering_user_id is the owner.
  const withAssignment = [
    { id: "a1", shift_id: "s1", covering_user_id: 7, type: "assignment" },
  ];
  assertEqual(
    Number(resolveOwnerId(shift, withAssignment)),
    7,
    "resolveOwnerId should return the assignment row's covering_user_id",
  );

  // A cover row layered on top must NOT change ownership — the owner is still 7,
  // even though user 9 works the 12:00–18:00 window.
  const withCover = [
    ...withAssignment,
    {
      id: "c1",
      shift_id: "s1",
      covering_user_id: 9,
      type: "cover",
      cover_start_date: "2999-01-06",
      cover_start_time: "12:00",
      cover_end_date: "2999-01-06",
      cover_end_time: "18:00",
    },
  ];
  assertEqual(
    Number(resolveOwnerId(shift, withCover)),
    7,
    "a cover row must not change the shift's owner",
  );

  // The cover overlaps the requested window fully → that window is worked by the
  // coverer (no gap left), while the un-covered remainder falls back to the
  // assignment owner.
  const covered = computeCoverageSummary({
    shift,
    activeRequest,
    coverages: withCover,
  });
  assert(
    covered.isFullyCovered,
    "a cover overlapping the whole requested window leaves no gap for the owner",
  );

  // With no cover, the whole window is still the owner's (nothing covered).
  const uncovered = computeCoverageSummary({
    shift,
    activeRequest,
    coverages: withAssignment,
  });
  assertEqual(
    uncovered.missingSegments.length,
    1,
    "with no cover row, the requested window is entirely the owner's (one gap)",
  );

  // No assignment row → no resolvable owner. Shift.original_user_id was removed
  // in Phase 4, so there is no fallback: a shift with no assignment row returns
  // undefined (a stray original_user_id-shaped field is ignored).
  assertEqual(
    resolveOwnerId({ ...shift, original_user_id: 4 }, []),
    undefined,
    "resolveOwnerId returns undefined when no assignment row exists (no legacy fallback)",
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

// Sidebar notifications are the "message that points the user directly to the
// item in the menu that caused the popup". This test pins, for every event
// type, BOTH that it fires for the right person and that its actionTarget
// deep-links to the exact KPI tab the user needs — and that the negative
// guards (my own outgoing requests, self-coverage, resolved coverage) stay
// silent. Kept in lockstep with notificationEvents.js.
function testComputeNotificationEvents() {
  const me = { serial_id: 1, full_name: "Me", email: "me@x.com" };
  const allUsers = [
    me,
    { serial_id: 2, full_name: "Alice", email: "alice@x.com" },
    { serial_id: 3, full_name: "Bob", email: "bob@x.com" },
  ];

  // Shifts are pure slots now — ownership is read from the base "assignment"
  // ShiftCoverage rows below, not from the shift.
  const shifts = [
    { id: "s1", start_date: "2999-01-06" }, // mine
    { id: "s2", start_date: "2999-01-07" }, // Alice's
    { id: "s3", start_date: "2999-01-08" }, // mine
    { id: "s4", start_date: "2999-01-09" }, // mine
  ];

  const swapRequests = [
    // Incoming Head2Head: Alice targets my shift (s1) → deep-link to the
    // swap_requests 'incoming' tab.
    {
      id: "rH2HIn",
      request_type: "Head2Head",
      status: "Open",
      requesting_user_id: 2,
      shift_ids: ["s2"],
      offered_shift_ids: ["s1"],
    },
    // Incoming gift: Bob offers to take my shift (s3) → 'incoming' tab.
    {
      id: "rGiftIn",
      request_type: "Gift",
      status: "Open",
      requesting_user_id: 3,
      shift_ids: ["s3"],
    },
    // My own open Full request → sr-pending, swap_requests 'mine' tab.
    {
      id: "rMineFull",
      request_type: "Full",
      status: "Open",
      requesting_user_id: 1,
      shift_ids: ["s4"],
    },
    // My own open Partial request — backs coverage c1 below (still Open, so it
    // yields coverage-new + sr-pending, but NOT a partial-outcome yet).
    {
      id: "rMinePartial",
      request_type: "Partial",
      status: "Open",
      requesting_user_id: 1,
      shift_ids: ["s1"],
    },
    // My resolved Partial request → sr-partial-outcome, deep-links to the
    // history ('approved') tab.
    {
      id: "rPartialDone",
      request_type: "Partial",
      status: "Closed",
      requesting_user_id: 1,
      shift_ids: ["s2"],
    },
    // Negative: my OWN outgoing Head2Head must never self-notify as incoming.
    {
      id: "rMineH2HOut",
      request_type: "Head2Head",
      status: "Open",
      requesting_user_id: 1,
      shift_ids: ["s1"],
      offered_shift_ids: ["s2"],
    },
    // Negative: a gift I SENT (its gifted shift isn't mine, and gifts are
    // excluded from sr-pending) should produce nothing for me.
    {
      id: "rGiftOut",
      request_type: "Gift",
      status: "Open",
      requesting_user_id: 1,
      shift_ids: ["s2"],
    },
  ];

  const coverages = [
    // Ownership ledger: one base "assignment" row per shift records the owner.
    { id: "aS1", shift_id: "s1", covering_user_id: 1, type: "assignment" }, // mine
    { id: "aS2", shift_id: "s2", covering_user_id: 2, type: "assignment" }, // Alice's
    { id: "aS3", shift_id: "s3", covering_user_id: 1, type: "assignment" }, // mine
    { id: "aS4", shift_id: "s4", covering_user_id: 1, type: "assignment" }, // mine
    // Bob offers coverage on my open Partial request (rMinePartial/s1).
    { id: "c1", shift_id: "s1", covering_user_id: 3, type: "cover" },
    // Negative: I'm both the shift owner and the coverer — must not fire.
    { id: "cSelf", shift_id: "s3", covering_user_id: 1, type: "cover" },
  ];

  const events = computeNotificationEvents({ me, shifts, swapRequests, coverages, allUsers });
  const fingerprints = events.map((e) => e.fingerprint);
  const has = (fp) => fingerprints.includes(fp);
  const targetOf = (fp) => events.find((e) => e.fingerprint === fp)?.actionTarget;

  // Every process fires the right event...
  assert(has("h2h-incoming:rH2HIn"), "incoming Head2Head request should notify me");
  assert(has("gift-offer:rGiftIn"), "an incoming gift offer on my shift should notify me");
  assert(has("sr-pending:rMineFull"), "my own still-open request should notify me it's pending");
  assert(has("coverage-new:c1"), "a new coverage offer on my shift should notify me");
  assert(has("sr-partial-outcome:rPartialDone"), "my resolved Partial request should notify me of its outcome");

  // ...and each message deep-links to the exact menu item that caused it.
  assertEqual(targetOf("h2h-incoming:rH2HIn"), "kpi:swap_requests:incoming",
    "an incoming Head2Head should deep-link to the swap-requests 'incoming' tab");
  assertEqual(targetOf("gift-offer:rGiftIn"), "kpi:swap_requests:incoming",
    "an incoming gift should deep-link to the swap-requests 'incoming' tab");
  assertEqual(targetOf("sr-pending:rMineFull"), "kpi:swap_requests:mine",
    "my pending request should deep-link to the swap-requests 'mine' tab");
  assertEqual(targetOf("coverage-new:c1"), "kpi:partial_gaps:mine",
    "a coverage offer on a Partial request should deep-link to the partial-gaps 'mine' tab");
  assertEqual(targetOf("sr-partial-outcome:rPartialDone"), "kpi:approved",
    "a resolved partial outcome should deep-link to the history ('approved') tab");

  // Negative guards — buttons/messages that don't belong stay silent.
  assert(!has("h2h-incoming:rMineH2HOut"), "my own outgoing Head2Head request should not self-notify");
  assert(!has("gift-offer:rGiftOut"), "a gift I sent should not notify me as an incoming offer");
  assert(!has("sr-pending:rGiftOut"), "a gift I sent should not surface as a pending swap request");
  assert(!has("coverage-new:cSelf"), "a coverage where I'm both owner and coverer should not notify");
  assert(!has("coverage-new:aS1"), "a base assignment row is ownership, not a coverage offer — it must not notify");
  assert(!has("coverage-new:aS4"), "a base assignment row must never fire a new-coverage event");

  // Fingerprint stability: identical input must yield an identical fingerprint
  // set (this is what useNotificationScanner's localStorage dedupe relies on).
  const secondRun = computeNotificationEvents({ me, shifts, swapRequests, coverages, allUsers });
  assertEqual(
    JSON.stringify([...fingerprints].sort()),
    JSON.stringify([...secondRun.map((e) => e.fingerprint)].sort()),
    "re-running with identical input should produce an identical fingerprint set",
  );
}

// --------------------------------------------------------------------------
// groupRules: the shared "active member of their own group" rule that gates
// every shift interaction, assignment dropdown, and the inactive-assignment
// marking. Scoped to the person's OWN group (by sign), matched on username,
// robust to a lingering `active` flag and to stale/duplicate rows.
// --------------------------------------------------------------------------
function testActiveGroupMember() {
  const person = { sign: "A", email: "me@x.com" };

  // The happy path: the person's own group's row is active and points at them.
  assert(
    isActiveGroupMember(person, [{ symbol: "A", active: true, username: "me@x.com" }]),
    "active member of their own group qualifies",
  );

  // Case-insensitive email match.
  assert(
    isActiveGroupMember(person, [{ symbol: "A", active: true, username: "ME@X.COM" }]),
    "email match is case-insensitive",
  );

  // The reported bug: the row stays active but its member was cleared
  // (username null) — nobody is really active, so the person must NOT qualify.
  assert(
    !isActiveGroupMember(person, [{ symbol: "A", active: true, username: null }]),
    "a lingering active flag with no member does not grant standing",
  );

  // Their email is the active member of ANOTHER group, but their own group's row
  // is inactive — a stale/other-group active row must never grant standing.
  assert(
    !isActiveGroupMember(person, [
      { symbol: "A", active: false, username: "me@x.com" },
      { symbol: "B", active: true, username: "me@x.com" },
    ]),
    "an active row under another group does not grant standing in one's own group",
  );

  // Someone else is the active member of the person's group.
  assert(
    !isActiveGroupMember(person, [{ symbol: "A", active: true, username: "other@x.com" }]),
    "a non-active member (someone else is starred) does not qualify",
  );

  // Duplicate rows for the same symbol resolve last-write-wins, matching the
  // admin map: the last row (inactive) is authoritative here.
  assert(
    !isActiveGroupMember(person, [
      { symbol: "A", active: true, username: "me@x.com" },
      { symbol: "A", active: false, username: null },
    ]),
    "duplicate rows resolve last-write-wins (last row inactive → not active)",
  );

  // No group / no email → never active.
  assert(!isActiveGroupMember({ email: "me@x.com" }, [{ symbol: "A", active: true, username: "me@x.com" }]),
    "a person with no group is never active");
  assert(!isActiveGroupMember({ sign: "A" }, [{ symbol: "A", active: true, username: "" }]),
    "a person with no email is never active");
  assert(!isActiveGroupMember(null, []), "a null person is never active");
}

// --------------------------------------------------------------------------
// interactionRules: which action buttons a shift's detail view shows, at every
// stage of every process. Each case is a full boolean snapshot so a button
// that MUST be hidden is asserted absent, not just the ones that show.
// --------------------------------------------------------------------------
function testShiftActionFlags() {
  // A plain white shift belonging to someone else, starting today, viewer is an
  // RR user who can take shifts, no request on it yet.
  const base = {
    isOwnShift: false,
    hasAnyRequest: false,
    hasActiveRequest: false,
    isCoveredOrClosed: false,
    isPartialRequest: false,
    isFullRequest: false,
    isWhiteShift: true,
    isRequestOwner: false,
    isPastShift: false,
    isPartialLike: false,
    canTakeShifts: true,
    hasMyCoverageEntry: false,
  };
  const flags = (overrides) => deriveShiftActionFlags({ ...base, ...overrides });

  // Stranger's white shift today: can gift it or propose a head-to-head, but
  // there's nothing to "offer cover" for and it isn't mine to request/cancel.
  const stranger = flags({});
  assert(stranger.canGift, "a stranger's white shift from today onward is giftable");
  assert(stranger.canHeadToHead, "a stranger's white shift allows a head-to-head offer");
  assert(!stranger.canOfferCover, "no active request → nothing to offer cover for");
  assert(!stranger.canRequestSwap, "can't request a swap on a shift that isn't mine");
  assert(!stranger.canCancelOwnSwap, "can't cancel a swap I don't own");
  assert(!stranger.canAddToCalendarOrEmail, "calendar/email is owner-only");

  // My own white shift today: I can request a swap or add it to my calendar,
  // but I can't gift/head-to-head/offer-cover my own shift.
  const mine = flags({ isOwnShift: true });
  assert(mine.canRequestSwap, "owner of an un-requested shift can request a swap");
  assert(mine.canAddToCalendarOrEmail, "owner can add their shift to the calendar");
  assert(!mine.canGift, "can't gift my own shift");
  assert(!mine.canHeadToHead, "can't propose a head-to-head against my own shift");
  assert(!mine.canOfferCover, "can't offer to cover my own shift");

  // Owner with an active request already out: can cancel it, can't re-request —
  // and cancelling must stay available even once fully covered/closed.
  const mineRequested = flags({ isOwnShift: true, hasAnyRequest: true });
  assert(mineRequested.canCancelOwnSwap, "owner can cancel their own outstanding request");
  assert(!mineRequested.canRequestSwap, "owner can't stack a second request on the same shift");
  const mineCovered = flags({ isOwnShift: true, hasAnyRequest: true, isCoveredOrClosed: true });
  assert(mineCovered.canCancelOwnSwap, "owner can reclaim their shift even once it's covered");

  // Someone else's shift carrying an active FULL request: I can offer to cover
  // or counter head-to-head, but it's no longer a giftable white shift.
  const fullReq = flags({ hasAnyRequest: true, hasActiveRequest: true, isFullRequest: true, isWhiteShift: false });
  assert(fullReq.canOfferCover, "an active full request can be covered");
  assert(fullReq.canHeadToHead, "an active full request can be countered head-to-head");
  assert(!fullReq.canGift, "a shift that already has a request isn't giftable");

  // Active PARTIAL request: coverable, but head-to-head is disallowed on partials.
  const partialReq = flags({
    hasAnyRequest: true, hasActiveRequest: true, isPartialRequest: true,
    isWhiteShift: false, isPartialLike: true,
  });
  assert(partialReq.canOfferCover, "an active partial request can be covered");
  assert(!partialReq.canHeadToHead, "head-to-head is not allowed against a partial request");

  // A head-to-head request aimed at one specific person: an unrelated viewer
  // must NOT be offered to help (it would route them into a request only the
  // target can act on). Directedness never suppresses the partial path.
  const directedFull = flags({
    hasAnyRequest: true, hasActiveRequest: true, isFullRequest: true,
    isWhiteShift: false, isDirectedRequest: true,
  });
  assert(!directedFull.canOfferCover, "a directed head-to-head request can't be helped by an unrelated viewer");
  const directedPartial = flags({
    hasAnyRequest: true, hasActiveRequest: true, isPartialRequest: true,
    isWhiteShift: false, isPartialLike: true, isDirectedRequest: true,
  });
  assert(directedPartial.canOfferCover, "a partial request stays coverable even if flagged directed");

  // A helper who took a full-swap takeover can back out; a helper on a partial
  // pick cannot self-cancel (only the owner unwinds a partial).
  const helperFull = flags({ hasMyCoverageEntry: true, isPartialLike: false });
  assert(helperFull.canCancelCoverage, "a full-swap helper can cancel their coverage");
  const helperPartial = flags({ hasMyCoverageEntry: true, isPartialLike: true });
  assert(!helperPartial.canCancelCoverage, "a partial-pick helper cannot self-cancel their coverage");
  const helperPast = flags({ hasMyCoverageEntry: true, isPastShift: true });
  assert(!helperPast.canCancelCoverage, "coverage on a past shift can't be cancelled");

  // Past shift: no new swap request (mine) and no head-to-head (stranger's).
  assert(!flags({ isOwnShift: true, isPastShift: true }).canRequestSwap, "no swap request on a past shift");
  assert(!flags({ isPastShift: true }).canHeadToHead, "no head-to-head on a past shift");

  // Covered/closed stranger shift: every helper action is off.
  const closed = flags({ isCoveredOrClosed: true });
  assert(!closed.canOfferCover, "a covered/closed shift can't be covered");
  assert(!closed.canHeadToHead, "a covered/closed shift can't be countered");
  assert(!closed.canGift, "a covered/closed shift can't be gifted");

  // Gift reach: a future white shift is giftable too (not just today's), while
  // a viewer who can't take shifts and any past shift both block gifting.
  assert(flags({ isPastShift: false }).canGift, "a future white shift is giftable, not only today's");
  assert(!flags({ canTakeShifts: false }).canGift, "a viewer who can't take shifts can't gift");
  assert(!flags({ isPastShift: true }).canGift, "a past shift isn't giftable");

  // Acquiring someone else's shift — offering to cover or proposing a
  // head-to-head — is likewise gated on canTakeShifts (only the active member
  // of a group may take on shifts).
  assert(
    !flags({ hasAnyRequest: true, hasActiveRequest: true, isFullRequest: true, isWhiteShift: false, canTakeShifts: false }).canOfferCover,
    "a viewer who can't take shifts can't offer to cover",
  );
  assert(
    !flags({ canTakeShifts: false }).canHeadToHead,
    "a viewer who can't take shifts can't propose a head-to-head",
  );
  // Opening a swap request on one's OWN shift is also gated on canTakeShifts: a
  // non-active group member is out of the swap system entirely (they can still
  // cancel an existing request — see canCancelOwnSwap below).
  assert(
    !flags({ isOwnShift: true, canTakeShifts: false }).canRequestSwap,
    "a non-active member can't open a swap request even on their own shift",
  );
  assert(
    flags({ isOwnShift: true, hasAnyRequest: true, canTakeShifts: false }).canCancelOwnSwap,
    "a non-active member can still cancel a swap request they already opened",
  );

  // WhatsApp share is only for the owner of an active request.
  assert(flags({ hasActiveRequest: true, isRequestOwner: true }).canWhatsappShare,
    "the owner of an active request can share it on WhatsApp");
  assert(!flags({ hasActiveRequest: true, isRequestOwner: false }).canWhatsappShare,
    "a non-owner can't share someone else's request on WhatsApp");
}

// --------------------------------------------------------------------------
// interactionRules: the exact button set a KPI list row renders, for each
// role the viewer can have on it (mine / incoming H2H / incoming gift /
// general-for-others / partial-gap owner / future shift), asserting both the
// buttons that belong and that ones that don't belong are absent.
// --------------------------------------------------------------------------
function testRequestItemButtons() {
  const currentUser = { serial_id: 1 };
  const buttons = (item, type, isFutureShiftsView = false) =>
    deriveRequestItemButtons({ item, currentUser, type, isFutureShiftsView });
  const sameSet = (a, b) =>
    JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

  // My own Full request in the swap_requests list: cancel + whatsapp, nothing else.
  const myFull = buttons(
    { id: "a", request_type: "Full", requesting_user_id: 1, status: "Open" },
    "swap_requests",
  );
  assert(sameSet(myFull, ["cancelMyRequest", "whatsapp"]),
    `my own request shows exactly cancel + whatsapp, got ${JSON.stringify(myFull)}`);
  assert(!myFull.includes("acceptGift"), "my own request must not show gift-accept buttons");

  // A gift I sent (I'm the giver): still my request → cancel + whatsapp so I can
  // re-share the offer.
  const myGift = buttons(
    { id: "b", request_type: "Gift", requesting_user_id: 1, original_user_id: 2, status: "Open" },
    "swap_requests",
  );
  assert(myGift.includes("whatsapp"), "the giver of a gift can re-share it on WhatsApp");
  assert(myGift.includes("cancelMyRequest"), "the giver of a gift can cancel it");

  // A gift addressed to me (I own the gifted shift): accept/reject only —
  // never a cancel or whatsapp.
  const incomingGift = buttons(
    { id: "c", request_type: "Gift", requesting_user_id: 2, original_user_id: 1, status: "Open" },
    "swap_requests",
  );
  assert(sameSet(incomingGift, ["acceptGift", "rejectGift"]),
    `an incoming gift shows exactly accept/reject, got ${JSON.stringify(incomingGift)}`);
  assert(!incomingGift.includes("cancelMyRequest"), "an incoming gift is not mine to cancel");

  // An incoming head-to-head targeting my shift: accept/reject the trade.
  const incomingH2H = buttons(
    { id: "d", request_type: "Head2Head", requesting_user_id: 2, offered_shifts: [{ original_user_id: 1 }], status: "Open" },
    "swap_requests",
  );
  assert(sameSet(incomingH2H, ["acceptHeadToHead", "rejectHeadToHead"]),
    `an incoming head-to-head shows exactly accept/reject, got ${JSON.stringify(incomingH2H)}`);

  // The "approved" list is read-only history: a closed incoming gift or
  // head-to-head surfaced there must render NO action buttons (accept/reject
  // don't otherwise gate on status, so this guards against them leaking in).
  const historyGift = buttons(
    { id: "d1", request_type: "Gift", requesting_user_id: 2, original_user_id: 1, status: "Closed" },
    "approved",
  );
  assert(sameSet(historyGift, []),
    `a closed gift in history shows no buttons, got ${JSON.stringify(historyGift)}`);
  const historyH2H = buttons(
    { id: "d2", request_type: "Head2Head", requesting_user_id: 2, offered_shifts: [{ original_user_id: 1 }], status: "Closed" },
    "approved",
  );
  assert(sameSet(historyH2H, []),
    `a closed head-to-head in history shows no buttons, got ${JSON.stringify(historyH2H)}`);

  // A General request by someone else, still open: I can take it or counter it.
  const generalOther = buttons(
    { id: "e", request_type: "General", requesting_user_id: 2, status: "Open" },
    "swap_requests",
  );
  assert(sameSet(generalOther, ["takeShifts", "counterHeadToHead"]),
    `an open general request shows take + counter, got ${JSON.stringify(generalOther)}`);

  // My own General request must not render a DUPLICATE cancel: in swap_requests
  // it's cancelled via cancelMyRequest, so cancelGeneralMine stays absent...
  const myGeneralInSwap = buttons(
    { id: "f", request_type: "General", requesting_user_id: 1, status: "Open" },
    "swap_requests",
  );
  assert(!myGeneralInSwap.includes("cancelGeneralMine"),
    "my general request in the swap-requests tab must not show a second cancel button");
  assert(myGeneralInSwap.includes("cancelMyRequest"),
    "my general request in the swap-requests tab cancels via cancelMyRequest");
  // ...but outside swap_requests, cancelGeneralMine is the only cancel.
  const myGeneralElsewhere = buttons(
    { id: "g", request_type: "General", requesting_user_id: 1, status: "Open" },
    "approved",
  );
  assert(myGeneralElsewhere.includes("cancelGeneralMine"),
    "my general request outside the swap-requests tab cancels via cancelGeneralMine");
  assert(!myGeneralElsewhere.includes("cancelMyRequest"),
    "cancelMyRequest is scoped to the swap-requests tab");

  // A future shift object of mine: calendar + reshare + request-swap. The
  // calendar/reshare buttons are gated on the future-shifts view...
  const futureShift = buttons(
    { id: "h", is_shift_object: true, requesting_user_id: 1 },
    "my_shifts",
    true,
  );
  assert(futureShift.includes("addToCalendar"), "a future shift can be added to the calendar");
  assert(futureShift.includes("reshareWhatsapp"), "a future shift can be re-shared");
  assert(futureShift.includes("requestSwap"), "a future shift can start a swap request");
  // ...and disappear outside it.
  const nonFutureShift = buttons(
    { id: "i", is_shift_object: true, requesting_user_id: 1 },
    "approved",
    false,
  );
  assert(!nonFutureShift.includes("addToCalendar"),
    "the calendar button only shows in the future-shifts view");
  assert(nonFutureShift.includes("requestSwap"),
    "request-swap is available on a shift object regardless of view");

  // Partial-gap owner with a backing request: a single cancel-gap button.
  const gapOwner = buttons(
    { id: "j", request_type: "Partial", requesting_user_id: 1, status: "Partially_Covered" },
    "partial_gaps",
  );
  assert(gapOwner.includes("cancelPartialGap"), "the owner of a partial gap can cancel it");
  // A covering user (not the owner) sees no cancel on the same gap.
  const gapCoverer = buttons(
    { id: "k", request_type: "Partial", requesting_user_id: 2, status: "Partially_Covered" },
    "partial_gaps",
  );
  assert(!gapCoverer.includes("cancelPartialGap"),
    "a covering user must not be able to cancel someone else's partial gap");

  // A non-active viewer (not the active member of their group, canTakeShifts
  // false) may not acquire anyone else's shift: the take / counter / accept
  // buttons are hidden, but declining stays available.
  const inactive = (item, type) =>
    deriveRequestItemButtons({ item, currentUser, type, canTakeShifts: false });
  const inactiveGeneral = inactive(
    { id: "l", request_type: "General", requesting_user_id: 2, status: "Open" },
    "swap_requests",
  );
  assert(sameSet(inactiveGeneral, []),
    `a non-active viewer sees no take/counter on a general request, got ${JSON.stringify(inactiveGeneral)}`);
  const inactiveGift = inactive(
    { id: "m", request_type: "Gift", requesting_user_id: 2, original_user_id: 1, status: "Open" },
    "swap_requests",
  );
  assert(sameSet(inactiveGift, ["rejectGift"]),
    `a non-active viewer can only decline an incoming gift, got ${JSON.stringify(inactiveGift)}`);
  const inactiveH2H = inactive(
    { id: "n", request_type: "Head2Head", requesting_user_id: 2, offered_shifts: [{ original_user_id: 1 }], status: "Open" },
    "swap_requests",
  );
  assert(sameSet(inactiveH2H, ["rejectHeadToHead"]),
    `a non-active viewer can only decline an incoming head-to-head, got ${JSON.stringify(inactiveH2H)}`);
  // Opening a swap request on one's own shift is ALSO gated on canTakeShifts: a
  // non-active member is out of the swap system, so requestSwap is absent for
  // them even on their own shift.
  const inactiveOwnShift = inactive(
    { id: "o", is_shift_object: true, requesting_user_id: 1 },
    "approved",
  );
  assert(!inactiveOwnShift.includes("requestSwap"),
    "a non-active viewer can't open a swap request even on their own shift");
  // But an ACTIVE member can, on the same own shift.
  const activeOwnShift = deriveRequestItemButtons(
    { item: { id: "o2", is_shift_object: true, requesting_user_id: 1 }, currentUser, type: "approved", canTakeShifts: true },
  );
  assert(activeOwnShift.includes("requestSwap"),
    "an active viewer can request a swap on their own shift");
}

// --------------------------------------------------------------------------
// interactionRules: KPI tab membership — which rows land in each swap_requests
// tab (all/mine/incoming) and each partial_gaps tab (all/mine/covering),
// including the privacy rule that hides gifts between OTHER people.
// --------------------------------------------------------------------------
function testRequestTabMembership() {
  const currentUser = { serial_id: 1 };

  const myFull = { id: "a", request_type: "Full", requesting_user_id: 1 };
  const otherFull = { id: "b", request_type: "Full", requesting_user_id: 2 };
  const myGift = { id: "c", request_type: "Gift", requesting_user_id: 1, original_user_id: 2 };
  const incomingGift = { id: "d", request_type: "Gift", requesting_user_id: 2, original_user_id: 1 };
  const strangerGift = { id: "e", request_type: "Gift", requesting_user_id: 2, original_user_id: 3 };
  const incomingH2H = { id: "f", request_type: "Head2Head", requesting_user_id: 2, offered_shifts: [{ original_user_id: 1 }] };
  const items = [myFull, otherFull, myGift, incomingGift, strangerGift, incomingH2H];
  const ids = (list) => list.map((i) => i.id);

  // "all": everything EXCEPT a gift between two other people.
  const all = filterRequestsForSwapTab(items, { swapTab: "all", currentUser });
  assert(!ids(all).includes("e"), "a gift between other people is hidden from the 'all' tab");
  assert(ids(all).includes("c"), "a gift I sent stays visible in the 'all' tab");
  assert(ids(all).includes("d"), "a gift addressed to me stays visible in the 'all' tab");
  assert(ids(all).includes("b"), "other people's non-gift requests stay visible in the 'all' tab");

  // "mine": only rows I initiated.
  const mine = filterRequestsForSwapTab(items, { swapTab: "mine", currentUser });
  assert(JSON.stringify(ids(mine).sort()) === JSON.stringify(["a", "c"]),
    `the 'mine' tab holds exactly my own requests, got ${JSON.stringify(ids(mine))}`);
  assert(!ids(mine).includes("d"), "a gift addressed to me is not in my 'mine' tab");

  // "incoming": trades/gifts addressed to me, initiated by others.
  const incoming = filterRequestsForSwapTab(items, { swapTab: "incoming", currentUser });
  assert(JSON.stringify(ids(incoming).sort()) === JSON.stringify(["d", "f"]),
    `the 'incoming' tab holds exactly the gift + h2h aimed at me, got ${JSON.stringify(ids(incoming))}`);
  assert(!ids(incoming).includes("b"), "a stranger's plain request is not 'incoming' to me");
  assert(!ids(incoming).includes("c"), "a gift I sent is not 'incoming' to me");

  // Partial-gaps tabs.
  const gaps = [
    { id: "g1", original_user_id: 1, covering_user_ids: [3] }, // mine
    { id: "g2", original_user_id: 2, covering_user_ids: [1] }, // I'm covering
    { id: "g3", original_user_id: 2, covering_user_ids: [3] }, // unrelated
  ];
  const gapIds = (list) => list.map((i) => i.id);
  assert(
    JSON.stringify(gapIds(filterPartialGapsForTab(gaps, { partialGapsTab: "mine", currentUser }))) === JSON.stringify(["g1"]),
    "partial-gaps 'mine' holds only gaps on my own shifts",
  );
  assert(
    JSON.stringify(gapIds(filterPartialGapsForTab(gaps, { partialGapsTab: "covering", currentUser }))) === JSON.stringify(["g2"]),
    "partial-gaps 'covering' holds only gaps I'm helping cover",
  );
  assert(
    filterPartialGapsForTab(gaps, { partialGapsTab: "all", currentUser }).length === 3,
    "partial-gaps 'all' holds every gap",
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
    id: "pure-resolve-ownership",
    name: "resolveOwnerId / coverage layering: assignment owns, cover overlaps window",
    category: "pure",
    run: testResolveOwnership,
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
  {
    id: "pure-active-group-member",
    name: "isActiveGroupMember: own-group-scoped active rule (lingering/stale/duplicate rows)",
    category: "pure",
    run: testActiveGroupMember,
  },
  {
    id: "pure-shift-action-flags",
    name: "deriveShiftActionFlags: swap/gift/offer/cover buttons at every stage (+ absent when they don't belong)",
    category: "pure",
    run: testShiftActionFlags,
  },
  {
    id: "pure-request-item-buttons",
    name: "deriveRequestItemButtons: exact KPI-row button set per role (accept/cancel/take/gift)",
    category: "pure",
    run: testRequestItemButtons,
  },
  {
    id: "pure-request-tab-membership",
    name: "filterRequestsForSwapTab / filterPartialGapsForTab: KPI tab membership + gift privacy",
    category: "pure",
    run: testRequestTabMembership,
  },
];
