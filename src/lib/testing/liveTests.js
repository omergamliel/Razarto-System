import { base44 } from "@/api/base44Client";
import { computeCoverageSummary } from "@/components/calendar/whatsappTemplates";
import { assert, assertEqual } from "./assert";

// Each test below replicates the exact base44.entities calls/status
// transitions that the corresponding mutation in ShiftCalendar.jsx performs
// (named in each comment), without importing from ShiftCalendar.jsx itself —
// see docs/manager.md and the plan this suite was built from for why. All
// entities are synthetic fixtures created via `ctx` (see fixtures.js) and
// are deleted by the runner after each test, pass or fail.

// Mirrors requestSwapMutation.
async function testCreateFullSwapRequest(ctx) {
  const owner = await ctx.createPerson();
  const shift = await ctx.createShift({ original_user_id: owner.serial_id });

  const request = await ctx.createSwapRequest({
    shift_ids: [shift.id],
    requesting_user_id: owner.serial_id,
    request_type: "Full",
    req_start_date: shift.start_date,
    req_end_date: shift.end_date,
    req_start_time: shift.start_time,
    req_end_time: shift.end_time,
  });
  const updatedShift = await base44.entities.Shift.update(shift.id, {
    status: "Swap_Requested",
  });

  assertEqual(request.status, "Open", "new full swap request should be Open");
  assertEqual(
    updatedShift.status,
    "Swap_Requested",
    "shift should flip to Swap_Requested",
  );
}

// Mirrors requestSwapMutation followed by cancelSwapMutation.
async function testCancelSwapRequestRevertsShift(ctx) {
  const owner = await ctx.createPerson();
  const shift = await ctx.createShift({ original_user_id: owner.serial_id });
  const request = await ctx.createSwapRequest({
    shift_ids: [shift.id],
    requesting_user_id: owner.serial_id,
    request_type: "Full",
    req_start_date: shift.start_date,
    req_end_date: shift.end_date,
    req_start_time: shift.start_time,
    req_end_time: shift.end_time,
  });
  await base44.entities.Shift.update(shift.id, { status: "Swap_Requested" });

  const cancelledRequest = await base44.entities.SwapRequest.update(request.id, {
    status: "Cancelled",
  });
  const revertedShift = await base44.entities.Shift.update(shift.id, {
    status: "Active",
  });

  assertEqual(cancelledRequest.status, "Cancelled", "request should be Cancelled");
  assertEqual(revertedShift.status, "Active", "shift should revert to Active");
}

// Mirrors offerCoverMutation's "no missing segments" branch.
async function testPartialSwapFullyCoveredCloses(ctx) {
  const owner = await ctx.createPerson();
  const helper = await ctx.createPerson();
  const shift = await ctx.createShift({ original_user_id: owner.serial_id });
  const request = await ctx.createSwapRequest({
    shift_ids: [shift.id],
    requesting_user_id: owner.serial_id,
    request_type: "Partial",
    req_start_date: shift.start_date,
    req_end_date: shift.end_date,
    req_start_time: "12:00",
    req_end_time: "18:00",
  });
  await base44.entities.Shift.update(shift.id, { status: "Swap_Requested" });

  const coverage = await ctx.createCoverage({
    request_id: request.id,
    shift_id: shift.id,
    covering_user_id: helper.serial_id,
    cover_start_date: request.req_start_date,
    cover_start_time: request.req_start_time,
    cover_end_date: request.req_end_date,
    cover_end_time: request.req_end_time,
  });

  const { missingSegments } = computeCoverageSummary({
    shift,
    activeRequest: request,
    coverages: [coverage],
  });
  assertEqual(missingSegments.length, 0, "full-window coverage should leave no gaps");

  const closedRequest = await base44.entities.SwapRequest.update(request.id, {
    status: "Closed",
  });
  const coveredShift = await base44.entities.Shift.update(shift.id, {
    status: "Covered",
  });

  assertEqual(closedRequest.status, "Closed", "request should close");
  assertEqual(coveredShift.status, "Covered", "shift should become Covered");
}

// Mirrors offerCoverMutation's "still missing segments" branch.
async function testPartialSwapPartiallyCoveredStaysOpen(ctx) {
  const owner = await ctx.createPerson();
  const helper = await ctx.createPerson();
  const shift = await ctx.createShift({ original_user_id: owner.serial_id });
  const request = await ctx.createSwapRequest({
    shift_ids: [shift.id],
    requesting_user_id: owner.serial_id,
    request_type: "Partial",
    req_start_date: shift.start_date,
    req_end_date: shift.end_date,
    req_start_time: "12:00",
    req_end_time: "18:00",
  });
  await base44.entities.Shift.update(shift.id, { status: "Swap_Requested" });

  const coverage = await ctx.createCoverage({
    request_id: request.id,
    shift_id: shift.id,
    covering_user_id: helper.serial_id,
    cover_start_date: request.req_start_date,
    cover_start_time: "12:00",
    cover_end_date: request.req_end_date,
    cover_end_time: "15:00", // only half the requested window
  });

  const { missingSegments } = computeCoverageSummary({
    shift,
    activeRequest: request,
    coverages: [coverage],
  });
  assertEqual(missingSegments.length, 1, "half-covered window should leave one gap");

  const partiallyCoveredRequest = await base44.entities.SwapRequest.update(
    request.id,
    { status: "Partially_Covered" },
  );
  const stillRequestedShift = await base44.entities.Shift.update(shift.id, {
    status: "Swap_Requested",
  });

  assertEqual(
    partiallyCoveredRequest.status,
    "Partially_Covered",
    "request should stay Partially_Covered",
  );
  assertEqual(
    stillRequestedShift.status,
    "Swap_Requested",
    "shift should remain in Swap_Requested",
  );
}

// Mirrors cancelMyCoverageMutation.
async function testCancelMyCoverageReopensGap(ctx) {
  const owner = await ctx.createPerson();
  const helper = await ctx.createPerson();
  const shift = await ctx.createShift({ original_user_id: owner.serial_id });
  const request = await ctx.createSwapRequest({
    shift_ids: [shift.id],
    requesting_user_id: owner.serial_id,
    request_type: "Partial",
    req_start_date: shift.start_date,
    req_end_date: shift.end_date,
    req_start_time: "12:00",
    req_end_time: "18:00",
    status: "Partially_Covered",
  });
  await base44.entities.Shift.update(shift.id, { status: "Swap_Requested" });
  const coverage = await ctx.createCoverage({
    request_id: request.id,
    shift_id: shift.id,
    covering_user_id: helper.serial_id,
    cover_start_date: request.req_start_date,
    cover_start_time: "12:00",
    cover_end_date: request.req_end_date,
    cover_end_time: "15:00",
  });

  const cancelledCoverage = await base44.entities.ShiftCoverage.update(
    coverage.id,
    { status: "Cancelled" },
  );
  // No other approved coverages remain on this request, so it reopens fully.
  const reopenedRequest = await base44.entities.SwapRequest.update(request.id, {
    status: "Open",
  });
  const shiftBackToRequested = await base44.entities.Shift.update(shift.id, {
    status: "Swap_Requested",
  });

  assertEqual(cancelledCoverage.status, "Cancelled", "coverage should be Cancelled");
  assertEqual(reopenedRequest.status, "Open", "request should reopen to Open");
  assertEqual(
    shiftBackToRequested.status,
    "Swap_Requested",
    "shift should stay in Swap_Requested",
  );
}

// The motivating example: mirrors createH2HRequestMutation (called twice
// against the same target) followed by acceptHeadToHeadRequestMutation
// (accepting the first). Documents + regression-tests the gap recorded in
// docs/manager.md: nothing stops a second Head2Head request against the same
// target, but accepting one must still clean up the other via staleSiblings.
async function testHeadToHeadDuplicateRequestSameTarget(ctx) {
  const requester = await ctx.createPerson(); // "A"
  const target = await ctx.createPerson(); // "B", owns the target shift

  const targetShift = await ctx.createShift({ original_user_id: target.serial_id });
  const offerShift1 = await ctx.createShift({ original_user_id: requester.serial_id });
  const offerShift2 = await ctx.createShift({ original_user_id: requester.serial_id });

  const request1 = await ctx.createSwapRequest({
    shift_ids: [offerShift1.id],
    offered_shift_ids: [targetShift.id],
    requesting_user_id: requester.serial_id,
    request_type: "Head2Head",
    req_start_date: offerShift1.start_date,
    req_end_date: offerShift1.end_date,
    req_start_time: offerShift1.start_time,
    req_end_time: offerShift1.end_time,
  });
  await base44.entities.Shift.update(offerShift1.id, { status: "Swap_Requested" });

  // createH2HRequestMutation never touches targetShift's status — this is
  // exactly why a second request against the same target is possible.
  const request2 = await ctx.createSwapRequest({
    shift_ids: [offerShift2.id],
    offered_shift_ids: [targetShift.id],
    requesting_user_id: requester.serial_id,
    request_type: "Head2Head",
    req_start_date: offerShift2.start_date,
    req_end_date: offerShift2.end_date,
    req_start_time: offerShift2.start_time,
    req_end_time: offerShift2.end_time,
  });
  await base44.entities.Shift.update(offerShift2.id, { status: "Swap_Requested" });

  const allRequests = await base44.entities.SwapRequest.list();
  const openSiblingsForTarget = allRequests.filter(
    (r) =>
      r.requesting_user_id === requester.serial_id &&
      r.offered_shift_ids?.includes(targetShift.id) &&
      r.status === "Open",
  );
  assertEqual(
    openSiblingsForTarget.length,
    2,
    "both Head2Head requests against the same target should coexist as Open",
  );

  // B accepts request1 — mirrors acceptHeadToHeadRequestMutation.
  const theirShiftIds = request1.shift_ids; // [offerShift1.id]
  const myShiftIds = request1.offered_shift_ids; // [targetShift.id]
  await Promise.all([
    ...myShiftIds.map((id) =>
      base44.entities.Shift.update(id, {
        original_user_id: request1.requesting_user_id,
        status: "Active",
      }),
    ),
    ...theirShiftIds.map((id) =>
      base44.entities.Shift.update(id, {
        original_user_id: target.serial_id,
        status: "Active",
      }),
    ),
  ]);
  await base44.entities.SwapRequest.update(request1.id, { status: "Closed" });

  const swappedIds = [...theirShiftIds, ...myShiftIds];
  const staleSiblings = allRequests.filter(
    (r) =>
      r.id !== request1.id &&
      ["Open", "Partially_Covered"].includes(r.status) &&
      (r.shift_ids?.some((id) => swappedIds.includes(id)) ||
        r.offered_shift_ids?.some((id) => swappedIds.includes(id))),
  );
  await Promise.all(
    staleSiblings.map((r) =>
      base44.entities.SwapRequest.update(r.id, { status: "Cancelled" }),
    ),
  );

  const reFetchedTarget = await base44.entities.Shift.get(targetShift.id);
  assertEqual(
    reFetchedTarget.original_user_id,
    requester.serial_id,
    "target shift should now be owned by the requester",
  );
  assert(
    staleSiblings.some((r) => r.id === request2.id),
    "the sibling request should have been picked up by the stale-sibling cleanup",
  );

  const allRequestsAfter = await base44.entities.SwapRequest.list();
  const request2State = allRequestsAfter.find((r) => r.id === request2.id);
  assertEqual(
    request2State?.status,
    "Cancelled",
    "the second Head2Head request should end up Cancelled once the first is accepted",
  );
}

// Mirrors generalSwitchRequestMutation followed by acceptGeneralRequestMutation.
async function testGeneralRequestAcceptWithoutTerms(ctx) {
  const requester = await ctx.createPerson();
  const accepter = await ctx.createPerson();
  const shift = await ctx.createShift({ original_user_id: requester.serial_id });

  const request = await ctx.createSwapRequest({
    shift_ids: [shift.id],
    offered_shift_ids: [],
    requesting_user_id: requester.serial_id,
    request_type: "General",
    req_start_date: shift.start_date,
    req_end_date: shift.end_date,
    req_start_time: shift.start_time,
    req_end_time: shift.end_time,
  });
  await base44.entities.Shift.update(shift.id, { status: "Swap_Requested" });

  const reassignedShift = await base44.entities.Shift.update(shift.id, {
    original_user_id: accepter.serial_id,
    status: "Active",
  });
  const closedRequest = await base44.entities.SwapRequest.update(request.id, {
    status: "Closed",
  });

  assertEqual(
    reassignedShift.original_user_id,
    accepter.serial_id,
    "shift should be reassigned to the accepter",
  );
  assertEqual(reassignedShift.status, "Active", "shift should be Active again");
  assertEqual(closedRequest.status, "Closed", "request should close");
}

// Mirrors reassignMutation (ShiftDetailsModal.jsx).
async function testReassignCancelsInFlightPartialSwap(ctx) {
  const owner = await ctx.createPerson();
  const helper = await ctx.createPerson();
  const newOwner = await ctx.createPerson();
  const shift = await ctx.createShift({
    original_user_id: owner.serial_id,
    status: "Swap_Requested",
  });
  const request = await ctx.createSwapRequest({
    shift_ids: [shift.id],
    requesting_user_id: owner.serial_id,
    request_type: "Partial",
    req_start_date: shift.start_date,
    req_end_date: shift.end_date,
    req_start_time: "12:00",
    req_end_time: "18:00",
    status: "Partially_Covered",
  });
  const coverage = await ctx.createCoverage({
    request_id: request.id,
    shift_id: shift.id,
    covering_user_id: helper.serial_id,
    cover_start_date: request.req_start_date,
    cover_start_time: "12:00",
    cover_end_date: request.req_end_date,
    cover_end_time: "15:00",
    status: "Approved",
  });

  const cancelledRequest = await base44.entities.SwapRequest.update(request.id, {
    status: "Cancelled",
  });
  const cancelledCoverage = await base44.entities.ShiftCoverage.update(coverage.id, {
    status: "Cancelled",
  });
  const reassignedShift = await base44.entities.Shift.update(shift.id, {
    original_user_id: newOwner.serial_id,
    status: "Active",
  });

  assertEqual(cancelledRequest.status, "Cancelled", "in-flight request should cancel");
  assertEqual(cancelledCoverage.status, "Cancelled", "granted coverage should cancel");
  assertEqual(
    reassignedShift.original_user_id,
    newOwner.serial_id,
    "shift should belong to the new owner",
  );
  assertEqual(reassignedShift.status, "Active", "shift should be plain Active again");
}

export const liveTests = [
  {
    id: "live-create-full-swap-request",
    name: "Create full swap request",
    category: "live",
    run: testCreateFullSwapRequest,
  },
  {
    id: "live-cancel-swap-request",
    name: "Cancel swap request reverts shift",
    category: "live",
    run: testCancelSwapRequestRevertsShift,
  },
  {
    id: "live-partial-fully-covered",
    name: "Partial swap fully covered closes request",
    category: "live",
    run: testPartialSwapFullyCoveredCloses,
  },
  {
    id: "live-partial-partially-covered",
    name: "Partial swap partially covered stays open",
    category: "live",
    run: testPartialSwapPartiallyCoveredStaysOpen,
  },
  {
    id: "live-cancel-my-coverage",
    name: "Cancelling my coverage reopens the gap",
    category: "live",
    run: testCancelMyCoverageReopensGap,
  },
  {
    id: "live-h2h-duplicate-target",
    name: "Head-to-head: duplicate requests to same target (ראש בראש edge case)",
    category: "live",
    run: testHeadToHeadDuplicateRequestSameTarget,
  },
  {
    id: "live-general-accept-without-terms",
    name: "General request: accept without terms",
    category: "live",
    run: testGeneralRequestAcceptWithoutTerms,
  },
  {
    id: "live-reassign-cancels-partial-swap",
    name: "Reassign cancels an in-flight partial swap",
    category: "live",
    run: testReassignCancelsInFlightPartialSwap,
  },
];
