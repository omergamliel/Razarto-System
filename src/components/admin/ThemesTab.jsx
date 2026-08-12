import React, { useEffect, useRef, useState } from "react";
import { Palette, CalendarDays, Check, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const DEFAULT_THEME_PALETTE = {
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

export default function ThemesTab() {
  const queryClient = useQueryClient();
  const [themePalette, setThemePalette] = useState(DEFAULT_THEME_PALETTE);

  // Persisted as ONE AppSettings row keyed setting_key='theme', storing the
  // palette as a JSON blob in `value` — same key-value pattern as the system /
  // support settings and the logo. Shares the ['app-settings'] cache.
  const { data: appSettings = [] } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => base44.entities.AppSettings.list(),
  });

  // Hydrate once from the saved row without clobbering in-progress edits. Deep
  // merge onto the defaults so a palette saved before a new color key existed
  // still fills that key from DEFAULT_THEME_PALETTE.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || appSettings.length === 0) return;
    const themeRow = appSettings.find((s) => s.setting_key === "theme");
    if (themeRow?.value) {
      try {
        const saved = JSON.parse(themeRow.value);
        setThemePalette((prev) => ({
          kpi: { ...prev.kpi, ...saved.kpi },
          calendar: { ...prev.calendar, ...saved.calendar },
          buttons: { ...prev.buttons, ...saved.buttons },
          hallOfFame: { ...prev.hallOfFame, ...saved.hallOfFame },
        }));
      } catch (error) {
        console.error("Failed to parse saved theme palette:", error);
      }
    }
    hydratedRef.current = true;
  }, [appSettings]);

  const saveThemeMutation = useMutation({
    mutationFn: async () => {
      const existing = appSettings.find((s) => s.setting_key === "theme");
      const value = JSON.stringify(themePalette);
      if (existing) {
        return base44.entities.AppSettings.update(existing.id, { value });
      }
      return base44.entities.AppSettings.create({
        setting_key: "theme",
        value,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("ערכת הנושא נשמרה בהצלחה");
    },
    onError: () => toast.error("שגיאה בשמירת ערכת הנושא"),
  });

  return (
    <div className="space-y-3 md:space-y-4 overflow-y-auto">
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-gray-800">
              דשבורד KPI
            </p>
            <p className="text-xs text-gray-500">
              בחירה בצבעי פסטל נעימים
            </p>
          </div>
          <Palette className="w-5 h-5 text-blue-500" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { key: "fullSwap", label: "בקשות להחלפה מלאה" },
            { key: "partialSwap", label: "בקשות להחלפה חלקית" },
            { key: "history", label: "היסטוריית החלפות" },
            { key: "futureShifts", label: "המשמרות העתידיות שלי" },
          ].map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50"
            >
              <div className="flex flex-col text-sm text-gray-700">
                <span className="font-semibold">{item.label}</span>
                <span className="text-xs text-gray-500">
                  גוון פסטלי מומלץ
                </span>
              </div>
              <input
                type="color"
                value={themePalette.kpi[item.key]}
                onChange={(e) =>
                  setThemePalette((prev) => ({
                    ...prev,
                    kpi: { ...prev.kpi, [item.key]: e.target.value },
                  }))
                }
                className="w-12 h-10 rounded-lg border border-gray-200"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-gray-800">
              תצוגה קלנדרית
            </p>
            <p className="text-xs text-gray-500">התאמת צבע לכל סטטוס</p>
          </div>
          <CalendarDays className="w-5 h-5 text-blue-500" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { key: "myShifts", label: "המשמרות שלי" },
            { key: "regularShift", label: "משמרת רגילה" },
            { key: "swapRequest", label: "בקשה להחלפה" },
            { key: "partialGap", label: "כיסוי חלקי – פער" },
            { key: "approvedSwap", label: "החלפה אושרה" },
          ].map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50"
            >
              <span className="text-sm font-semibold text-gray-800">
                {item.label}
              </span>
              <input
                type="color"
                value={themePalette.calendar[item.key]}
                onChange={(e) =>
                  setThemePalette((prev) => ({
                    ...prev,
                    calendar: {
                      ...prev.calendar,
                      [item.key]: e.target.value,
                    },
                  }))
                }
                className="w-12 h-10 rounded-lg border border-gray-200"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-gray-800">
              כפתורים
            </p>
            <p className="text-xs text-gray-500">
              התאמה לפעולות נפוצות
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { key: "volunteer", label: "אני רוצה לעזור" },
            { key: "swapDirect", label: "החלפה ראש בראש" },
            { key: "whatsapp", label: "שיתוף בווצאפ" },
            { key: "calendar", label: "הוספה ליומן" },
            { key: "requestSwap", label: "בקש החלפה" },
            { key: "cancel", label: "ביטול" },
            { key: "cancelRequest", label: "ביטול בקשת החלפה" },
          ].map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50"
            >
              <span className="text-sm font-semibold text-gray-800">
                {item.label}
              </span>
              <input
                type="color"
                value={themePalette.buttons[item.key]}
                onChange={(e) =>
                  setThemePalette((prev) => ({
                    ...prev,
                    buttons: {
                      ...prev.buttons,
                      [item.key]: e.target.value,
                    },
                  }))
                }
                className="w-12 h-10 rounded-lg border border-gray-200"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-gray-800">
              היכל התהילה
            </p>
            <p className="text-xs text-gray-500">
              עיצוב רקע לשלושת המקומות
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { key: "first", label: "מקום ראשון" },
            { key: "second", label: "מקום שני" },
            { key: "third", label: "מקום שלישי" },
          ].map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50"
            >
              <span className="text-sm font-semibold text-gray-800">
                {item.label}
              </span>
              <input
                type="color"
                value={themePalette.hallOfFame[item.key]}
                onChange={(e) =>
                  setThemePalette((prev) => ({
                    ...prev,
                    hallOfFame: {
                      ...prev.hallOfFame,
                      [item.key]: e.target.value,
                    },
                  }))
                }
                className="w-12 h-10 rounded-lg border border-gray-200"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end pb-2">
        <Button
          onClick={() => saveThemeMutation.mutate()}
          disabled={saveThemeMutation.isPending}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2 shadow-md shadow-blue-200 h-11 px-6"
        >
          {saveThemeMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          <span>שמירת שינויים</span>
        </Button>
      </div>
    </div>
  );
}