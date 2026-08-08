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
  const requestById = new Map(swapRequests.map((r) => [r.id, r]));

  const events = [];

  // 1. Incoming Head2Head request: one of my shifts sits in offered_shift_ids.
  swapRequests.forEach((r) => {
    if (
      r.request_type === "Head2Head" &&
      r.status === "Open" &&
      Number(r.requesting_user_id) !== myId &&
      (r.offered_shift_ids || []).some(
        (id) => Number(shiftById.get(id)?.original_user_id) === myId,
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

  // 2 & 3. Coverage offered / cancelled on a shift I own.
  coverages.forEach((c) => {
    const shift = shiftById.get(c.shift_id);
    if (!shift) return;
    if (Number(shift.original_user_id) !== myId) return;
    if (Number(c.covering_user_id) === myId) return;

    const parentRequest = requestById.get(c.request_id);
    const coverer = nameOf(allUsers, c.covering_user_id);
    const dateLabel = formatShiftDate(shift);

    if (c.status === "Cancelled") {
      events.push({
        fingerprint: `coverage-cancelled:${c.id}`,
        type: "partial",
        title: "כיסוי בוטל",
        body: `${coverer} ביטל/ה את הכיסוי למשמרת שלך (${dateLabel}) — הפער נפתח מחדש`,
        actionLabel: "צפייה בפער",
        actionTarget: "kpi:partial_gaps:mine",
      });
      return;
    }

    if (c.status === "Pending" || c.status === "Approved") {
      const resolved =
        !!parentRequest && RESOLVED_STATUSES.includes(parentRequest.status);
      const isPartialParent = parentRequest?.request_type === "Partial";
      events.push({
        fingerprint: `coverage-new:${c.id}`,
        type: resolved ? "covered" : "partial",
        title: resolved ? "המשמרת שלך כוסתה" : "הוצע כיסוי למשמרת שלך",
        body: `${coverer} ${resolved ? "כיסה/תה" : "הציע/ה לכסות"} את המשמרת שלך (${dateLabel})`,
        actionLabel: "צפייה בבקשה",
        actionTarget: isPartialParent
          ? "kpi:partial_gaps:mine"
          : "kpi:swap_requests:mine",
      });
    }
  });

  // 4 & 5. My request got resolved, or a request I helped cover got resolved.
  swapRequests.forEach((r) => {
    if (!RESOLVED_STATUSES.includes(r.status)) return;

    if (Number(r.requesting_user_id) === myId) {
      const firstShiftId = (r.shift_ids || [])[0];
      const currentOwnerId = shiftById.get(firstShiftId)?.original_user_id;
      // Ownership only actually transfers for Head2Head/General accepts; a
      // Full/Partial request closed via coverage leaves original_user_id
      // untouched, so there's no "accepter" to name here (the coverage
      // event above already named the coverer).
      const accepterName =
        currentOwnerId != null && Number(currentOwnerId) !== myId
          ? nameOf(allUsers, currentOwnerId)
          : null;
      events.push({
        fingerprint: `sr-closed:${r.id}`,
        type: "covered",
        title: "הבקשה שלך נסגרה",
        body: accepterName
          ? `הבקשה שלך נסגרה — ${accepterName} קיבל/ה`
          : "הבקשה שלך נסגרה בהצלחה",
        actionLabel: "צפייה בהיסטוריה",
        actionTarget: "kpi:approved",
      });
      return;
    }

    const myCoverageOnThisRequest = coverages.some(
      (c) =>
        c.request_id === r.id &&
        Number(c.covering_user_id) === myId &&
        c.status !== "Cancelled",
    );
    if (myCoverageOnThisRequest) {
      events.push({
        fingerprint: `sr-closed-covered-by-me:${r.id}`,
        type: "covered",
        title: "הבקשה שסייעת לכסות נסגרה",
        body: "הבקשה שהצעת לכסות בה נסגרה בהצלחה",
        actionLabel: "צפייה בהיסטוריה",
        actionTarget: "kpi:approved",
      });
    }
  });

  return events;
}
