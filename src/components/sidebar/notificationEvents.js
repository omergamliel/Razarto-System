import { format } from "date-fns";

// Statuses that mean "this SwapRequest is fully resolved" — SwapRequest.jsonc's
// schema enum only lists Closed/Cancelled, but Completed is used as a synonym
// for Closed in several places across the app (see docs/manager.md gaps).
const RESOLVED_STATUSES = ["Closed", "Completed"];

function nameOf(allUsers, serialId) {
  return (
    allUsers.find((u) => Number(u.serial_id) === Number(serialId))
      ?.full_name || "מישהו"
  );
}

function formatShiftDate(shift) {
  if (!shift?.start_date) return "";
  try {
    return format(new Date(shift.start_date), "dd/MM");
  } catch {
    return shift.start_date;
  }
}

// Pure snapshot-diff: derives "things relevant to `me`" from the current
// state of the four core entities, with no I/O and no notion of *how* the
// state got there. Each returned event carries a stable `fingerprint` so the
// caller (useNotificationScanner) can dedupe against what's already been
// shown, across reloads, without needing a realtime/push channel.
export function computeNotificationEvents({
  me,
  shifts = [],
  swapRequests = [],
  coverages = [],
  allUsers = [],
}) {
  if (!me?.serial_id) return [];
  const myId = Number(me.serial_id);

  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  // Ownership is read from the base "assignment" ShiftCoverage row (the
  // ownership ledger). Shift.original_user_id was removed in Phase 4, so there
  // is no fallback. Built once as a map to keep the per-shift lookups cheap.
  const assignmentOwnerByShift = new Map(
    coverages
      .filter((c) => c.type === "assignment")
      .map((c) => [c.shift_id, c.covering_user_id]),
  );
  const ownerOf = (shift) =>
    shift ? assignmentOwnerByShift.get(shift.id) : undefined;

  const events = [];

  // 1. Incoming Head2Head request: one of my shifts sits in offered_shift_ids.
  swapRequests.forEach((r) => {
    if (
      r.request_type === "Head2Head" &&
      r.status === "Open" &&
      Number(r.requesting_user_id) !== myId &&
      (r.offered_shift_ids || []).some(
        (id) => Number(ownerOf(shiftById.get(id))) === myId,
      )
    ) {
      events.push({
        fingerprint: `h2h-incoming:${r.id}`,
        type: "swap_requested",
        title: "בקשת החלפה ראש בראש חדשה",
        body: `${nameOf(allUsers, r.requesting_user_id)} הציע/ה לך החלפה ראש בראש`,
        actionLabel: "צפייה בבקשה",
        actionTarget: "kpi:swap_requests:incoming",
      });
    }
  });

  // 1b. Incoming gift offer: someone (an RR user) offered to take one of my
  // shifts as a gift — a SwapRequest with request_type "Gift", still Open, whose
  // gifted shift (shift_ids) I own. It isn't applied until I accept it from my
  // incoming-requests list, so surface it as an actionable offer, not a done deal.
  swapRequests.forEach((r) => {
    if (r.request_type !== "Gift") return;
    if (r.status !== "Open") return;
    if (Number(r.requesting_user_id) === myId) return;
    const giftedShift = (r.shift_ids || [])
      .map((id) => shiftById.get(id))
      .find((s) => s && Number(ownerOf(s)) === myId);
    if (!giftedShift) return;
    events.push({
      fingerprint: `gift-offer:${r.id}`,
      type: "gift",
      title: "הוצעה לך מתנה 🎁",
      body: `${nameOf(allUsers, r.requesting_user_id)} מציע לקחת על עצמו את המשמרת שלך (${formatShiftDate(giftedShift)}) במתנה — אשרו את ההצעה כדי להשתחרר מהמשמרת`,
      actionLabel: "צפייה בהצעה",
      actionTarget: "kpi:swap_requests:incoming",
    });
  });

  // 2 & 3. Coverage offered on a shift I own (no "cancelled" event here — a
  // helper can't cancel their own coverage as a user action; the only way a
  // shift's coverage disappears is the owner reverting the whole shift to
  // Active via cancelSwapMutation, which doesn't warrant notifying them
  // about their own action).
  coverages.forEach((c) => {
    // Only "cover" rows are helpers taking a window; the base "assignment" row
    // is ownership, not a coverage offer (Phase 4).
    if (c.type === "assignment") return;
    const shift = shiftById.get(c.shift_id);
    if (!shift) return;
    if (Number(ownerOf(shift)) !== myId) return;
    if (Number(c.covering_user_id) === myId) return;

    const coverer = nameOf(allUsers, c.covering_user_id);
    const dateLabel = formatShiftDate(shift);

    // A cover no longer stores its parent request id; the parent is the live
    // request on the same shift.
    const parentRequest = swapRequests.find(
      (r) => r.shift_ids?.includes(c.shift_id) && r.status !== "Cancelled",
    );

    const resolved =
      !!parentRequest && RESOLVED_STATUSES.includes(parentRequest.status);
    const isPartialParent = parentRequest?.request_type === "Partial";
    events.push({
      // The resolved state is part of the fingerprint so the message tracks the
      // shift's real state: when a still-open cover ("offered") later closes the
      // shift ("covered"), the old fingerprint stops matching and its popup is
      // pulled, while the new one is raised — without this the wording froze at
      // whatever it was the first time the owner saw it.
      fingerprint: `coverage-new:${c.id}:${resolved ? "covered" : "offered"}`,
      type: resolved ? "covered" : "partial",
      title: resolved ? "המשמרת שלך כוסתה" : "הוצע כיסוי למשמרת שלך",
      body: `${coverer} ${resolved ? "כיסה/תה" : "הציע/ה לכסות"} את המשמרת שלך (${dateLabel})`,
      actionLabel: "צפייה בבקשה",
      actionTarget: isPartialParent
        ? "kpi:partial_gaps:mine"
        : "kpi:swap_requests:mine",
    });
  });

  // 4. One of my own swap requests is still waiting for help. Gifts are
  // excluded — the giver already got a confirmation toast, and this message's
  // "swap request" wording doesn't fit a one-directional gift offer.
  swapRequests.forEach((r) => {
    if (Number(r.requesting_user_id) !== myId) return;
    if (r.request_type === "Gift") return;

    // A Partial request keeps waiting through "Partially_Covered" (some hours
    // claimed, more still open) — it isn't done until it's Closed/Cancelled
    // (handled by event 5). General/H2H only have the single "Open" wait.
    const isPartial = r.request_type === "Partial";
    const stillWaiting = isPartial
      ? ["Open", "Partially_Covered"].includes(r.status)
      : r.status === "Open";
    if (!stillWaiting) return;

    events.push({
      // Status is part of the fingerprint so Open → Partially_Covered swaps the
      // wording (old popup pulled, new one raised) instead of freezing.
      fingerprint: `sr-pending:${r.id}:${r.status}`,
      type: "swap_requested",
      title: "הבקשה שלך עדיין ממתינה",
      body: isPartial
        ? r.status === "Partially_Covered"
          ? "חלק מהשעות שביקשת כוסו — עדיין נותרו שעות פתוחות בבקשה"
          : "בקשת הכיסוי החלקי שלך עדיין ממתינה למענה"
        : "בקשת ההחלפה שלך עדיין לא התקבלה על ידי אף אחד",
      actionLabel: "צפייה בבקשה",
      actionTarget: isPartial
        ? "kpi:partial_gaps:mine"
        : "kpi:swap_requests:mine",
    });
  });

  // 5. Final help-outcome of one of my own Partial swap requests, once it's
  // done (Closed = fully covered; otherwise Cancelled — classify by whether
  // any coverage was ever created for it, since cancelling clears coverage
  // status but not the coverage records themselves).
  swapRequests.forEach((r) => {
    if (r.request_type !== "Partial") return;
    if (Number(r.requesting_user_id) !== myId) return;
    if (!RESOLVED_STATUSES.includes(r.status) && r.status !== "Cancelled")
      return;

    const everHadCoverage = coverages.some(
      (c) => c.type !== "assignment" && r.shift_ids?.includes(c.shift_id),
    );

    let title, body, type;
    if (RESOLVED_STATUSES.includes(r.status)) {
      title = "הבקשה החלקית שלך קיבלה מענה מלא";
      body = "כל השעות שביקשת עבור המשמרת שלך כוסו";
      type = "covered";
    } else if (everHadCoverage) {
      title = "הבקשה החלקית שלך קיבלה מענה חלקי";
      body = "רק חלק מהשעות שביקשת כוסו לפני שהבקשה הסתיימה";
      type = "partial";
    } else {
      title = "הבקשה החלקית שלך לא קיבלה מענה";
      body = "אף אחד לא הציע כיסוי לשעות שביקשת";
      type = "info";
    }

    events.push({
      fingerprint: `sr-partial-outcome:${r.id}`,
      type,
      title,
      body,
      actionLabel: "צפייה בהיסטוריה",
      actionTarget: "kpi:approved",
    });
  });

  return events;
}
