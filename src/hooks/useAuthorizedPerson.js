import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

// Real backend check: confirms the current user's email appears in the
// AuthorizedPerson whitelist. This is a server-side data query through the
// authenticated SDK — the result cannot be spoofed from the client, so the
// route guard can safely fail closed on it. Returns null while loading or
// when there is no email to check (i.e. user not authenticated yet).
export function useAuthorizedPerson(email) {
  const normalizedEmail = typeof email === "string" ? email.toLowerCase() : "";

  const { data, isLoading } = useQuery({
    queryKey: ["authorized-person", normalizedEmail],
    queryFn: async () => {
      if (!normalizedEmail) return null;
      const allPeople = await base44.entities.AuthorizedPerson.list();
      return (
        allPeople.find(
          (p) => p.email && p.email.toLowerCase() === normalizedEmail,
        ) || null
      );
    },
    enabled: !!normalizedEmail,
    staleTime: 1000 * 60 * 2,
  });

  return {
    authorizedPerson: data,
    isChecking: isLoading,
    isAuthorized: !!data,
  };
}

// The palette used across the app when nothing (or only a partial palette) has
// been saved by an admin under ניהול מערכת ▸ ערכת נושא. Kept in sync with the
// editor in src/components/admin/ThemesTab.jsx — both merge saved values onto
// these defaults so a palette persisted before a key existed still resolves.
export const DEFAULT_THEME_PALETTE = {
  kpi: {
    fullSwap: "#ef4444",
    partialSwap: "#eab308",
    history: "#22c55e",
    futureShifts: "#3b82f6",
  },
  calendar: {
    myShifts: "#3b82f6",
    regularShift: "#9ca3af",
    swapRequest: "#ef4444",
    partialGap: "#eab308",
    approvedSwap: "#22c55e",
    // Shift assigned to someone who is NOT the active member of a group.
    // Applied to the cell and shown in the calendar legend for managers/admins.
    inactiveGroupShift: "#f97316",
  },
  buttons: {
    volunteer: "#3b82f6",
    swapDirect: "#6366f1",
    whatsapp: "#25d366",
    calendar: "#2563eb",
    requestSwap: "#ef4444",
    cancel: "#dc2626",
    cancelRequest: "#dc2626",
  },
  hallOfFame: {
    first: "#eab308",
    second: "#9ca3af",
    third: "#f97316",
  },
};

// Settings groups are stored as one AppSettings row per key, with the group's
// values JSON-serialised into `value` (setting_key: "system" | "support" |
// "theme"). Parse the row for a given key, tolerating an absent/corrupt blob.
const parseGroup = (rows, key) => {
  const row = rows.find((s) => s.setting_key === key);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value);
  } catch (error) {
    console.error(`Failed to parse AppSettings "${key}" value:`, error);
    return null;
  }
};

// Reads the AppSettings entity via the same ["app-settings"] cache key the rest
// of the app already uses, so writes from the admin modal invalidate every
// consumer at once.
export function useAppSettings() {
  return useQuery({
    queryKey: ["app-settings"],
    queryFn: () => base44.entities.AppSettings.list(),
  });
}

// The effective theme palette: admin-saved values deep-merged onto the
// defaults so any missing group/key falls back gracefully.
export function useThemePalette() {
  const { data: rows = [] } = useAppSettings();
  return useMemo(() => {
    const saved = parseGroup(rows, "theme") || {};
    return {
      kpi: { ...DEFAULT_THEME_PALETTE.kpi, ...saved.kpi },
      calendar: { ...DEFAULT_THEME_PALETTE.calendar, ...saved.calendar },
      buttons: { ...DEFAULT_THEME_PALETTE.buttons, ...saved.buttons },
      hallOfFame: { ...DEFAULT_THEME_PALETTE.hallOfFame, ...saved.hallOfFame },
    };
  }, [rows]);
}

// The saved system settings group (title / subtitle / keywords /
// offlineMessage / systemStatus), or an empty object when nothing is saved.
export function useSystemSettings() {
  const { data: rows = [] } = useAppSettings();
  return useMemo(() => parseGroup(rows, "system") || {}, [rows]);
}

// The AppSettings setting_key that stores the global "treat RR users as
// read-only viewers" switch (a JSON blob { rrAsViewer: boolean }). Admin-toggled
// in AdminSettingsModal ▸ settings; read app-wide so every client reacts at once
// through the shared ["app-settings"] cache.
export const VIEWER_MODE_KEY = "viewer_mode";

// True while the admin "RR ⇒ viewer" switch is on. When on, an RR user is
// treated as a read-only viewer: they still see everything an RR user sees, but
// cannot create swap requests or change any data. Their stored `permissions`
// are NOT modified — this is a runtime overlay only.
export function useViewerMode() {
  const { data: rows = [] } = useAppSettings();
  return useMemo(
    () => Boolean(parseGroup(rows, VIEWER_MODE_KEY)?.rrAsViewer),
    [rows],
  );
}

// The single rule for "is THIS user currently a read-only viewer". Two ways to
// be one:
//   1. The dedicated "Viewer" permission level — a permanent, per-user view-only
//      role (sees everything an RR user sees, but can never take or change a
//      shift). Independent of the global switch and of group membership.
//   2. The global "RR ⇒ viewer" switch is on AND their real level is "RR".
// Managers and Admins are never downgraded. Kept here so every consumer derives
// it the same way and the overlay can't drift between call sites.
export function isViewerFor(permissions, viewerModeOn) {
  if (permissions === "Viewer") return true;
  return Boolean(viewerModeOn) && permissions === "RR";
}

// The AppSettings setting_key holding the "אילוצים" (constraints) config — a
// JSON blob { maxDates: number }. `maxDates` (K) is the MONTHLY THRESHOLD: users
// may set any number of constraints, but crossing K constraints within a single
// calendar month signals managers. (The stored field is still named `maxDates`
// for backward compatibility.) Admin-set in AdminSettingsModal ▸ אילוצים.
export const CONSIDERATION_KEY = "consideration";

// Default K when nothing has been saved yet.
export const DEFAULT_CONSIDERATION_MAX = 5;

// The effective K (monthly constraint threshold). Reads the shared
// ["app-settings"] cache so a change by an admin reaches every client at once.
// Falls back to DEFAULT_CONSIDERATION_MAX for an absent or non-positive value.
export function useConsiderationMaxDates() {
  const { data: rows = [] } = useAppSettings();
  return useMemo(() => {
    const raw = parseGroup(rows, CONSIDERATION_KEY)?.maxDates;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CONSIDERATION_MAX;
  }, [rows]);
}
