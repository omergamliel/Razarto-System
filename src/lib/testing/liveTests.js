import { base44 } from "@/api/base44Client";
import {
  computeCoverageSummary,
  syncAssignmentOwner,
} from "@/components/calendar/whatsappTemplates";
import { assert, assertEqual } from "./assert";

// Each test below replicates the exact base44.entities calls the corresponding
// mutation in ShiftCalendar.jsx / ShiftDetailsModal.jsx performs (named in each
// comment), without importing from those components themselves — see
// docs/manager.md and the plan this suite was built from for why. All entities
// are synthetic fixtures created via `ctx` (see fixtures.js) and are deleted by
// the runner after each test, pass or fail.
//
// Post Phase 4: a Shift is a pure time slot; ownership lives in a base
// "assignment" ShiftCoverage row (created for every `ctx.createShift({ owner })`);
// a helper taking a window is a `type:"cover"` row; cancel = delete that row.
// There is no Shift.status / Shift.original_user_id / ShiftCoverage.status /
// ShiftCoverage.request_id anymore, so no test writes or reads them.

// Mirrors requestSwapMutation.
async function testCreateFullSwapRequest(ctx) {
  const owner = await ctx.createPerson();
  const shift = await ctx.createShift({ owner: owner.serial_id });

  const request = await ctx.createSwapRequest({
    shift_ids: [shift.id],
    requesting_user_id: owner.serial_id,
    request_type: "Full",
    req_start_date: shift.start_date,
    req_end_date: shift.end_date,
    req_start_time: shift.start_time,
    req_end_time: shift.end_time,
  });

  assertEqual(request.status, "Open", "new full swap request should be Open");
  // The shift is a pure slot now — requesting a swap doesn't mutate it, and the
  // owner is still recorded by the untouched base assignment row.
  assertEqual(
    await ctx.getOwner(shift.id),
    owner.serial_id,
    "requesting a swap leaves the base assignment owner unchanged",
  );
}

// Mirrors requestSwapMutation followed by cancelSwapMutation.
async function testCancelSwapRequestClearsCovers(ctx) {
  const owner = await ctx.createPerson();
  const shift = await ctx.createShift({ owner: owner.serial_id });
  const request = await ctx.createSwapRequest({
    shift_ids: [shift.id],
    requesting_user_id: owner.serial_id,
    request_type: "Full",
    req_start_date: shift.start_date,
    req_end_date: shift.end_date,
    req_start_time: shift.start_time,
    req_end_time: shift.end_time,
  });

  // cancelSwapMutation: delete every non-assignment (cover) row on the shift,
  // then mark the request Cancelled. A full request with no covers yet has none
  // to delete, but the delete-cover step must still be a no-op that leaves the
  // base assignment row intact.
  const covers = await base44.entities.ShiftCoverage.filter({ shift_id: shift.id });
  await Promise.all(
    covers
      .filter((c) => c.type !== "assignment")
      .map((c) => base44.entities.ShiftCoverage.delete(c.id)),
  );
  const cancelledRequest = await base44.entities.SwapRequest.update(request.id, {
    status: "Cancelled",
  });

  assertEqual(cancelledRequest.status, "Cancelled", "request should be Cancelled");
  assertEqual(
    await ctx.getOwner(shift.id),
    owner.serial_id,
    "owner still owns the shift after cancelling the swap",
  );
}

// Mirrors offerCoverMutation's "no missing segments" branch.
async function testPartialSwapFullyCoveredCloses(ctx) {
  const owner = await ctx.createPerson();
  const helper = await ctx.createPerson();
  const shift = await ctx.createShift({ owner: owner.serial_id });
  const request = await ctx.createSwapRequest({
    shift_ids: [shift.id],
    requesting_user_id: owner.serial_id,
    request_type: "Partial",
    req_start_date: shift.start_date,
    req_end_date: shift.end_date,
    req_start_time: "12:00",
    req_end_time: "18:00",
  });

  // offerCoverMutation: add a type:"cover" row for the taken window.
  const coverage = await ctx.createCoverage({
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
  assertEqual(closedRequest.status, "Closed", "request should close when no segments remain");
}

// Mirrors offerCoverMutation's "still missing segments" branch.
async function testPartialSwapPartiallyCoveredStaysOpen(ctx) {
  const owner = await ctx.createPerson();
  const helper = await ctx.createPerson();
  const shift = await ctx.createShift({ owner: owner.serial_id });
  const request = await ctx.createSwapRequest({
    shift_ids: [shift.id],
    requesting_user_id: owner.serial_id,
    request_type: "Partial",
    req_start_date: shift.start_date,
    req_end_date: shift.end_date,
    req_start_time: "12:00",
    req_end_time: "18:00",
  });

  const coverage = await ctx.createCoverage({
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
  assertEqual(
    partiallyCoveredRequest.status,
    "Partially_Covered",
    "request should stay Partially_Covered while a gap remains",
  );
}

// Mirrors cancelMyCoverageMutation.
async function testCancelMyCoverageReopensGap(ctx) {
  const owner = await ctx.createPerson();
  const helper = await ctx.createPerson();
  const shift = await ctx.createShift({ owner: owner.serial_id });
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
    shift_id: shift.id,
    covering_user_id: helper.serial_id,
    cover_start_date: request.req_start_date,
    cover_start_time: "12:00",
    cover_end_date: request.req_end_date,
    cover_end_time: "15:00",
  });

  // cancelMyCoverageMutation: delete the helper's own cover row, then recompute.
  await base44.entities.ShiftCoverage.delete(coverage.id);
  ctx.untrack(coverage.id);

  const remaining = await base44.entities.ShiftCoverage.filter({ shift_id: shift.id });
  const remainingCovers = remaining.filter((c) => c.type !== "assignment");
  assertEqual(remainingCovers.length, 0, "the only cover row is gone after cancelling");

  // No cover rows remain on this request, so it reopens fully.
  const reopenedRequest = await base44.entities.SwapRequest.update(request.id, {
    status: "Open",
  });
  assertEqual(reopenedRequest.status, "Open", "request should reopen to Open");
  assertEqual(
    await ctx.getOwner(shift.id),
    owner.serial_id,
    "owner is unchanged by a helper cancelling their coverage",
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

  const targetShift = await ctx.createShift({ owner: target.serial_id });
  const offerShift1 = await ctx.createShift({ owner: requester.serial_id });
  const offerShift2 = await ctx.createShift({ owner: requester.serial_id });

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

  // createH2HRequestMutation never touches the target shift — this is exactly
  // why a second request against the same target is possible.
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

  // B accepts request1 — mirrors acceptHeadToHeadRequestMutation, which now
  // reassigns the base assignment rows (covering_user_id) instead of writing
  // Shift.original_user_id.
  const theirShiftIds = request1.shift_ids; // [offerShift1.id]
  const myShiftIds = request1.offered_shift_ids; // [targetShift.id]
  await Promise.all(
    myShiftIds.map((id) =>
      syncAssignmentOwner(id, request1.requesting_user_id, null),
    ),
  );
  await Promise.all(
    theirShiftIds.map((id) => syncAssignmentOwner(id, target.serial_id, null)),
  );
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

  assertEqual(
    await ctx.getOwner(targetShift.id),
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
  const shift = await ctx.createShift({ owner: requester.serial_id });

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

  // acceptGeneralRequestMutation: reassign the base assignment row, close request.
  await syncAssignmentOwner(shift.id, accepter.serial_id, null);
  const closedRequest = await base44.entities.SwapRequest.update(request.id, {
    status: "Closed",
  });

  assertEqual(
    await ctx.getOwner(shift.id),
    accepter.serial_id,
    "shift should be reassigned to the accepter",
  );
  assertEqual(closedRequest.status, "Closed", "request should close");
}

// Mirrors reassignMutation (ShiftDetailsModal.jsx).
async function testReassignCancelsInFlightPartialSwap(ctx) {
  const owner = await ctx.createPerson();
  const helper = await ctx.createPerson();
  const newOwner = await ctx.createPerson();
  const shift = await ctx.createShift({ owner: owner.serial_id });
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
    shift_id: shift.id,
    covering_user_id: helper.serial_id,
    cover_start_date: request.req_start_date,
    cover_start_time: "12:00",
    cover_end_date: request.req_end_date,
    cover_end_time: "15:00",
  });

  // reassignMutation: cancel the in-flight request, delete its cover rows, then
  // reassign the base assignment row to the new owner.
  const cancelledRequest = await base44.entities.SwapRequest.update(request.id, {
    status: "Cancelled",
  });
  await base44.entities.ShiftCoverage.delete(coverage.id);
  ctx.untrack(coverage.id);
  await syncAssignmentOwner(shift.id, newOwner.serial_id, null);

  assertEqual(cancelledRequest.status, "Cancelled", "in-flight request should cancel");
  const remainingCovers = await base44.entities.ShiftCoverage.filter({
    shift_id: shift.id,
    type: "cover",
  });
  assertEqual(remainingCovers.length, 0, "granted coverage row should be deleted");
  assertEqual(
    await ctx.getOwner(shift.id),
    newOwner.serial_id,
    "shift should belong to the new owner",
  );
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
    name: "Cancel swap request clears covers, keeps owner",
    category: "live",
    run: testCancelSwapRequestClearsCovers,
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
