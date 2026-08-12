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
