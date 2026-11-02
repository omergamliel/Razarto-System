import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Check, Loader2, Trash2 } from "lucide-react";
import HolidayDivisionsStrip from "./HolidayDivisionsStrip";
import { holidayDayKeys } from "@/lib/holidayDivisions";

const todayKey = () => format(new Date(), "yyyy-MM-dd");
const formatDay = (key) =>
  key ? format(new Date(`${key}T00:00:00`), "dd/MM/yyyy") : "";

const draftFrom = (definition) => ({
  name: definition.name || "",
  divisions: definition.divisions ?? "",
  division_breaks: definition.division_breaks || [],
});

const breaksKey = (list) => (list || []).filter(Boolean).join("|");

// One holiday DEFINITION in the admin list. A holiday is no longer a dated
// row per year: it is the chag's name as it appears in the Hebrew calendar
// plus its split, so the same row applies to every year and the dates come
// from the calendar at distribution time. "חלוקות" is how many different
// people share the chag (1 = one person takes every shift, 2 = two shifts per
// person, and so on, two shifts per person by default); the strip under the
// fields previews the upcoming occurrence (every colour is one person) and its
// partitions can be dragged. Those partitions are saved as day offsets, so they
// follow the chag into every year.
export default function HolidayRow({
  definition,
  occurrences = [],
  onSave,
  onDelete,
  isSaving,
}) {
  const [draft, setDraft] = useState(() => draftFrom(definition));

  useEffect(() => {
    setDraft(draftFrom(definition));
  }, [
    definition.id,
    definition.name,
    definition.divisions,
    definition.division_breaks,
  ]);

  // The next time this chag falls — or its last occurrence in the preview span.
  const occurrence = useMemo(() => {
    const upcoming = occurrences.find(
      (item) => (item.end_date || item.start_date) >= todayKey(),
    );
    return upcoming || occurrences[occurrences.length - 1] || null;
  }, [occurrences]);

  const dayKeys = useMemo(
    () => (occurrence ? holidayDayKeys(occurrence.start_date, occurrence.end_date) : []),
    [occurrence],
  );

  // The saved offsets, expressed as the dates of the previewed occurrence, so
  // the strip shows (and drags) exactly the same partitions.
  const stripBreaks = useMemo(
    () => (draft.division_breaks || []).map((offset) => dayKeys[Number(offset)]).filter(Boolean),
    [draft.division_breaks, dayKeys],
  );

  const changed =
    draft.name.trim() !== (definition.name || "") ||
    String(draft.divisions ?? "") !== String(definition.divisions ?? "") ||
    breaksKey(draft.division_breaks) !== breaksKey(definition.division_breaks);

  const setField = (patch) => setDraft((prev) => ({ ...prev, ...patch }));

  return (
    <div
      className={`rounded-xl border px-3 py-2 ${
        dayKeys.length > 1
          ? "border-amber-300 bg-amber-50/70 shadow-sm"
          : "border-gray-100 bg-gray-50"
      }`}
      dir="rtl"
    >
      {dayKeys.length > 1 && (
        <div className="mb-1.5 flex items-center gap-2">
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white">
            חג של {dayKeys.length} ימים
          </span>
          <span className="text-[11px] text-gray-500" dir="ltr">
            {formatDay(occurrence.start_date)} – {formatDay(occurrence.end_date)}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-12 gap-2 items-end">
        <div className="col-span-2 md:col-span-5 grid gap-1">
          <Label className="text-xs text-gray-500">שם החג</Label>
          <Input
            value={draft.name}
            onChange={(e) => setField({ name: e.target.value })}
            className="rounded-xl"
          />
        </div>
        <div className="col-span-1 md:col-span-2 grid gap-1">
          <Label className="text-xs text-gray-500">חלוקות</Label>
          <Input
            type="number"
            min="1"
            step="1"
            placeholder="אוטומטי · 2 משמרות לאדם"
            title="1 = כל המשמרות לאדם אחד, 2 = שתי משמרות לאדם"
            value={draft.divisions}
            onChange={(e) =>
              // Changing the number re-splits the chag evenly, discarding the
              // partitions that were dragged by hand.
              setField({ divisions: e.target.value, division_breaks: [] })
            }
            className="rounded-xl"
          />
        </div>
        <div className="col-span-1 md:col-span-5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-500 leading-tight">
            {occurrence
              ? `המופע הבא: ${formatDay(occurrence.start_date)}`
              : "השם לא נמצא בלוח העברי — החג לא ייכלל בחלוקה"}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              title="שמור"
              disabled={!changed || isSaving}
              onClick={() => onSave(definition, draft)}
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4 text-green-600" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              title="מחק"
              onClick={() => onDelete(definition)}
            >
              <Trash2 className="w-4 h-4 text-red-500" />
            </Button>
          </div>
        </div>
      </div>

      {!occurrence && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-700">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          ודאו שהשם זהה לשם החג בלוח העברי (למשל "פסח", "סוכות").
        </p>
      )}

      {dayKeys.length > 0 && (
        <div className="mt-2">
          <HolidayDivisionsStrip
            startDate={occurrence.start_date}
            endDate={occurrence.end_date}
            divisions={draft.divisions}
            breaks={stripBreaks}
            onBreaksChange={(list) =>
              // Each partition adds one more share, so the number of חלוקות
              // always matches what the strip shows, and each partition is
              // saved as its day offset inside the chag.
              setField({
                division_breaks: list.map((key) => dayKeys.indexOf(key)).filter((i) => i > 0),
                divisions: list.length + 1,
              })
            }
          />
        </div>
      )}
    </div>
  );
}