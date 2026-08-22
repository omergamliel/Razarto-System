import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}


export const isIframe = window.self !== window.top;

// ---------------------------------------------------------------------------
// Interaction rules
//
// Single source of truth for the "which action is allowed / which button
// shows" decisions that used to live inline inside ShiftDetailsModal.jsx and
// KPIListModal.jsx. Extracting them here makes every process (swap at each
// stage, gift, offer, accept) unit-testable without any backend/data-entity
// dependency — see src/lib/testing/pureTests.js. The components import these
// and render straight off their results, so the tests guard the real UI.
//
// Everything here is a pure function of already-resolved primitives; no I/O,
// no React, no date "now" lookups (callers pass isPastShift/isTodayShift in).
// ---------------------------------------------------------------------------

// An active, still-actionable SwapRequest: Open or Partially_Covered. Anything
// Closed/Cancelled/Completed is resolved and no longer offer-able.
export const isOpenStatus = (status) =>
  ["Open", "Partially_Covered"].includes(status);

// ---------------------------------------------------------------------------
// ShiftDetailsModal: which action buttons a single shift's detail view shows.
// Inputs are the intermediates the modal already computes (ownership, request
// state, coverage state, past/today, role). Returns only booleans.
// ---------------------------------------------------------------------------
export function deriveShiftActionFlags({
  isOwnShift,
  hasAnyRequest,
  hasActiveRequest,
  isCoveredOrClosed,
  isPartialRequest,
  isFullRequest,
  isWhiteShift,
  isRequestOwner,
  isPastShift,
  isPartialLike,
  canTakeShifts,
  // Boolean(myCoverageEntry): the viewer has an approved coverage window on
  // this shift (they joined a partial swap as a helper).
  hasMyCoverageEntry,
  // A head-to-head request the owner aimed at ONE specific other person (it
  // offers that person specific shifts in return). Only that target can act on
  // it, so an unrelated viewer must not be offered to help. Partial requests
  // are never directed, so this never suppresses the partial-coverage path.
  isDirectedRequest,
}) {
  // A helper who committed to a partial gap can no longer self-cancel (only the
  // owner undoes the whole request); backing out of a full-swap takeover is ok.
  const canCancelCoverage =
    Boolean(hasMyCoverageEntry) && !isPastShift && !isPartialLike;
  // The owner can always undo their own request, even once fully covered —
  // this reclaims the shift, so it must NOT be blocked by isCoveredOrClosed.
  const canCancelOwnSwap = isOwnShift && hasAnyRequest;
  // Offer-to-help is available on an active request that isn't mine and isn't
  // already covered — but NOT on a head-to-head aimed at one specific person
  // (an unrelated viewer can't help with that). A partial request is always
  // open to helpers, so it stays coverable even if flagged directed.
  const canOfferCover =
    hasActiveRequest &&
    !isOwnShift &&
    !isCoveredOrClosed &&
    (!isDirectedRequest || isPartialRequest);
  const canHeadToHead =
    !isOwnShift &&
    !isCoveredOrClosed &&
    !isPartialRequest &&
    !isPastShift &&
    (isWhiteShift || isFullRequest);
  // Gated on !hasAnyRequest (not just !hasActiveRequest) so a Closed request
  // still blocks a redundant new one, and on !isPastShift to close the
  // request-swap-on-a-past-shift side door.
  const canRequestSwap = isOwnShift && !hasAnyRequest && !isPastShift;
  const canWhatsappShare = hasActiveRequest && isRequestOwner;
  const canAddToCalendarOrEmail = isOwnShift;
  // Gift any plain, un-swapped shift from today onward — a colleague's shift
  // today or on any future date can be taken off their hands. Only past shifts
  // are excluded (isPastShift keys off the shift's start date, so an overnight
  // shift that began yesterday is still treated as past and stays non-giftable).
  const canGift =
    canTakeShifts &&
    !isOwnShift &&
    !isPastShift &&
    isWhiteShift &&
    !isCoveredOrClosed;

  return {
    canCancelCoverage,
    canCancelOwnSwap,
    canOfferCover,
    canHeadToHead,
    canRequestSwap,
    canWhatsappShare,
    canAddToCalendarOrEmail,
    canGift,
  };
}

// ---------------------------------------------------------------------------
// KPIListModal: per-item role flags for one request/shift row, given the
// viewer and which KPI list (`type`) it's being shown in.
// ---------------------------------------------------------------------------
export function deriveRequestItemFlags(item, { currentUser, type }) {
  const myId = currentUser?.serial_id;
  const currentUserIdNum = Number(myId);

  const isMyRequest = item.requesting_user_id === myId;
  const isPartial = (item.request_type || "").toLowerCase() === "partial";

  // Head2Head where one of the offered/target shifts is mine — someone is
  // proposing to trade with me specifically; I can accept/decline.
  const isIncomingHeadToHead =
    item.request_type === "Head2Head" &&
    !isMyRequest &&
    Boolean(
      item.offered_shifts?.some((s) => s.original_user_id === myId),
    );
  // Gift offer addressed to me: someone offered to take one of my shifts.
  const isIncomingGift =
    item.request_type === "Gift" &&
    !isMyRequest &&
    item.original_user_id === myId;

  const isPartialGapLike =
    type === "partial_gaps" || item.is_partial_in_progress;
  // Actionable only in the live partial-gaps list — an in-progress partial
  // surfaced under "approved" is read-only history.
  const isPartialGapActionable = type === "partial_gaps";
  const isPartialGapOwner =
    isPartialGapActionable &&
    Number(item.requesting_user_id) === currentUserIdNum;
  // Only real backing SwapRequest entities carry a status; the synthetic
  // partial-gap fallback item doesn't.
  const hasBackingRequest = Boolean(item.status);

  const isGeneralRequestOpen =
    item.request_type === "General" && isOpenStatus(item.status);
  const isGeneralRequestForOthers = isGeneralRequestOpen && !isMyRequest;
  const isGeneralRequestMine = isGeneralRequestOpen && isMyRequest;

  return {
    isMyRequest,
    isPartial,
    isIncomingHeadToHead,
    isIncomingGift,
    isPartialGapLike,
    isPartialGapActionable,
    isPartialGapOwner,
    hasBackingRequest,
    isGeneralRequestOpen,
    isGeneralRequestForOthers,
    isGeneralRequestMine,
  };
}

// The exact set of action buttons KPIListModal renders for one row, expressed
// as stable keys. This mirrors the JSX render conditions in KPIListModal 1:1
// (each group is gated on the same flags below) and exists so tests can assert
// the full button set — including that buttons which don't belong are absent.
// Keep in sync with the button groups in KPIListModal.jsx.
export function deriveRequestItemButtons({
  item,
  currentUser,
  type,
  isFutureShiftsView,
}) {
  const flags = deriveRequestItemFlags(item, { currentUser, type });
  const buttons = [];

  // type === "swap_requests" && isMyRequest → cancel + whatsapp (whatsapp is
  // gift-aware but always present for my own request now).
  if (type === "swap_requests" && flags.isMyRequest) {
    buttons.push("cancelMyRequest", "whatsapp");
  }

  if (flags.isPartialGapOwner && flags.hasBackingRequest) {
    buttons.push("cancelPartialGap");
  }

  if (flags.isGeneralRequestForOthers) {
    buttons.push("takeShifts", "counterHeadToHead");
  }

  // The duplicate-cancel fix: a General request that is mine only shows its
  // cancel here when NOT already covered by the swap_requests+isMyRequest row.
  if (flags.isGeneralRequestMine && type !== "swap_requests") {
    buttons.push("cancelGeneralMine");
  }

  if (flags.isIncomingHeadToHead) {
    buttons.push("acceptHeadToHead", "rejectHeadToHead");
  }

  if (flags.isIncomingGift) {
    buttons.push("acceptGift", "rejectGift");
  }

  if (item.is_shift_object || flags.isMyRequest) {
    // "שמור ביומן" only in the future-shifts (my_shifts) view.
    if (isFutureShiftsView) buttons.push("addToCalendar");
    if (isFutureShiftsView && item.is_shift_object) buttons.push("reshareWhatsapp");
    if (item.is_shift_object) buttons.push("requestSwap");
  }

  return buttons;
}

// KPIListModal "בקשות להחלפה" (swap_requests) tab membership.
export function filterRequestsForSwapTab(items, { swapTab, currentUser }) {
  const myId = currentUser?.serial_id;
  if (swapTab === "mine") {
    return items.filter((item) => item.requesting_user_id === myId);
  }
  if (swapTab === "incoming") {
    // Addressed to me: a Head2Head whose offered/target shift is mine, or a
    // Gift to take one of my shifts (its gifted shift's owner is me).
    return items.filter(
      (item) =>
        item.requesting_user_id !== myId &&
        (item.offered_shifts?.some((s) => s.original_user_id === myId) ||
          (item.request_type === "Gift" && item.original_user_id === myId)),
    );
  }
  // "all" — hide gifts between OTHER people (private to giver + recipient) but
  // keep gifts I'm part of, so a gift I just sent still shows in the menu.
  return items.filter(
    (item) =>
      item.request_type !== "Gift" ||
      item.requesting_user_id === myId ||
      Number(item.original_user_id) === Number(myId),
  );
}

// KPIListModal "משמרות בפער חלקי" (partial_gaps) tab membership.
export function filterPartialGapsForTab(items, { partialGapsTab, currentUser }) {
  const myId = currentUser?.serial_id;
  if (partialGapsTab === "mine") {
    return items.filter((item) => item.original_user_id === myId);
  }
  if (partialGapsTab === "covering") {
    return items.filter((item) => item.covering_user_ids?.includes(myId));
  }
  return items;
}
