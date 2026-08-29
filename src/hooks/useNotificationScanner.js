import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { addMessage, removeByFingerprint } from "@/components/sidebar/messageStore";
import { computeNotificationEvents } from "@/components/sidebar/notificationEvents";
import { useConsiderationMaxDates } from "@/hooks/useAuthorizedPerson";

const SEEN_KEY_PREFIX = "razarto_notif_seen_";

function loadSeen(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}

// Scans current entity state (no websocket/push exists in this app) and
// surfaces a popup for anything relevant to the logged-in user that hasn't
// been shown before. Reuses the same React Query keys ShiftCalendar.jsx
// already fetches with, so this never causes an extra network round-trip
// when both are mounted — it only adds a second *consumer* of the same
// cached data. See docs/components_sidebar.md for the event catalog.
export function useNotificationScanner() {
  const { data: currentUser } = useQuery({
    queryKey: ["current-user"],
    queryFn: () => base44.auth.me(),
  });
  const userEmail = (currentUser?.email || currentUser?.Email || "").toLowerCase();

  const { data: allUsers = [] } = useQuery({
    queryKey: ["all-users"],
    queryFn: () => base44.entities.AuthorizedPerson.list(),
    enabled: !!userEmail,
  });

  const me = useMemo(
    () => allUsers.find((u) => u.email?.toLowerCase() === userEmail) || null,
    [allUsers, userEmail],
  );

  const { data: shifts = [] } = useQuery({
    queryKey: ["shifts"],
    queryFn: () => base44.entities.Shift.list(),
    enabled: !!me,
  });

  const { data: swapRequests = [] } = useQuery({
    queryKey: ["swap-requests"],
    queryFn: () => base44.entities.SwapRequest.list(),
    enabled: !!me,
  });

  const { data: coverages = [] } = useQuery({
    queryKey: ["coverages"],
    queryFn: () => base44.entities.ShiftCoverage.list(),
    enabled: !!me,
  });

  // Constraint (אילוץ) threshold signal is manager-only, so the requests are
  // only fetched for managers/admins (matches the calendar's own gating).
  const isManager = me?.permissions === "Manager" || me?.permissions === "Admin";
  const considerationThreshold = useConsiderationMaxDates();
  const { data: considerationRequests = [] } = useQuery({
    queryKey: ["consideration-requests"],
    queryFn: () => base44.entities.ConsiderationRequest.list(),
    enabled: !!me && isManager,
  });

  useEffect(() => {
    if (!me) return;

    const events = computeNotificationEvents({
      me,
      shifts,
      swapRequests,
      coverages,
      allUsers,
      considerationRequests,
      considerationThreshold,
    });

    const seenKey = `${SEEN_KEY_PREFIX}${me.serial_id}`;
    const seen = loadSeen(seenKey);
    const currentFingerprints = new Set(events.map((e) => e.fingerprint));
    let changed = false;

    events.forEach((event) => {
      if (!seen.has(event.fingerprint)) {
        addMessage(event);
        seen.add(event.fingerprint);
        changed = true;
      }
    });

    // Drop fingerprints that no longer match any current candidate (e.g. a
    // gift/swap offer that was accepted, declined, or cancelled) so the set
    // stays bounded. Fingerprints are id+state based and never legitimately
    // recur once dropped, so this can't cause a re-notification. Also pull the
    // popup that was raised for it — otherwise a resolved offer's message
    // lingers in the sidebar until manually dismissed.
    seen.forEach((fp) => {
      if (!currentFingerprints.has(fp)) {
        seen.delete(fp);
        removeByFingerprint(fp);
        changed = true;
      }
    });

    if (changed) {
      localStorage.setItem(seenKey, JSON.stringify([...seen]));
    }
  }, [
    me,
    shifts,
    swapRequests,
    coverages,
    allUsers,
    considerationRequests,
    considerationThreshold,
  ]);
}
