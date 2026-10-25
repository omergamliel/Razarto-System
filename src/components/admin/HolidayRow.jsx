import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Loader2, Trash2 } from "lucide-react";
import HolidayDivisionsStrip from "./HolidayDivisionsStrip";
import { defaultDivisions, holidayDayCount } from "@/lib/holidayDivisions";

const draftFrom = (holiday) => {
  const start_date = holiday.start_date || "";
  const end_date = holiday.end_date || "";
  return {
    name: holiday.name || "",
    start_date,
    end_date,
    // A holiday with no explicit number starts at the system default: two
    // shifts per person, so the number follows the chag's length.
    divisions:
      holiday.divisions ??
      defaultDivisions(holidayDayCount(start_date, end_date || start_date)),
    division_breaks: holiday.division_breaks || [],
  };
};

const breaksKey = (list) => (list || []).filter(Boolean).join("|");

// One holiday in the admin list: its name and dates, plus the split of its
// shifts — "חלוקות" is how many different people share the chag (1 = one person
// takes every shift, 2 = two shifts per person, and so on, two shifts per person
// by default). The strip under the fields shows, cell by cell, which shift goes
// to which person, and the partition between two neighbours can be dragged to
// move a shift from one person to the other. Saving lights up once something
// changed.
export default function HolidayRow({
  holiday,
  DateInput,
  onSave,
  onDelete,
  isSaving,
}) {
  const [draft, setDraft] = useState(() => draftFrom(holiday));

  useEffect(() => {
    setDraft(draftFrom(holiday));
  }, [
    holiday.id,
    holiday.name,
    holiday.start_date,
    holiday.end_date,
    holiday.divisions,
    holiday.division_breaks,
  ]);

  const changed =
    draft.name !== (holiday.name || "") ||
    draft.start_date !== (holiday.start_date || "") ||
    draft.end_date !== (holiday.end_date || "") ||
    Number(draft.divisions || 1) !== Number(holiday.divisions ?? 1) ||
    breaksKey(draft.division_breaks) !== breaksKey(holiday.division_breaks);

  const setField = (patch) => setDraft((prev) => ({ ...prev, ...patch }));

  // New dates mean new shift days: back to the default split (two shifts per
  // person) with the partitions wherever they fall.
  const setDates = (patch) =>
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      return {
        ...next,
        divisions: defaultDivisions(
          holidayDayCount(next.start_date, next.end_date || next.start_date),
        ),
        division_breaks: [],
      };
    });

  const dayCount = holidayDayCount(draft.start_date, draft.end_date || draft.start_date);
  const isMultiDay = dayCount > 1;

  return (
    <div
      className={`rounded-xl border px-3 py-2 ${
        isMultiDay
          ? "border-amber-300 bg-amber-50/70 shadow-sm"
          : "border-gray-100 bg-gray-50"
      }`}
      dir="rtl"
    >
      {isMultiDay && (
        <div className="mb-1.5 flex items-center">
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white">
            חג של {dayCount} ימים
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-12 gap-2 items-end">
        <div className="col-span-2 md:col-span-3 grid gap-1">
          <Label className="text-xs text-gray-500">שם החג</Label>
          <Input
            value={draft.name}
            onChange={(e) => setField({ name: e.target.value })}
            className="rounded-xl"
          />
        </div>
        <div className="md:col-span-3 grid gap-1">
          <Label className="text-xs text-gray-500">מתאריך</Label>
          <DateInput
            value={draft.start_date}
            onChange={(iso) => setDates({ start_date: iso })}
            className="rounded-xl"
          />
        </div>
        <div className="md:col-span-3 grid gap-1">
          <Label className="text-xs text-gray-500">עד תאריך</Label>
          <DateInput
            value={draft.end_date}
            onChange={(iso) => setDates({ end_date: iso })}
            className="rounded-xl"
          />
        </div>
        <div className="md:col-span-1 grid gap-1">
          <Label className="text-xs text-gray-500">חלוקות</Label>
          <Input
            type="number"
            min="1"
            step="1"
            value={draft.divisions}
            title="1 = כל המשמרות לאדם אחד, 2 = שתי משמרות לאדם"
            onChange={(e) =>
              // Changing the number re-splits the chag evenly, discarding the
              // partitions that were dragged by hand.
              setField({ divisions: e.target.value, division_breaks: [] })
            }
            className="rounded-xl"
          />
        </div>
        <div className="col-span-2 flex items-center justify-end gap-1 md:col-span-2">
          <Button
            size="icon"
            variant="ghost"
            title="שמור"
            disabled={!changed || isSaving}
            onClick={() => onSave(holiday, draft)}
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
            onClick={() => onDelete(holiday)}
          >
            <Trash2 className="w-4 h-4 text-red-500" />
          </Button>
        </div>
      </div>

      {dayCount > 0 && (
        <div className="mt-2">
          <HolidayDivisionsStrip
            startDate={draft.start_date}
            endDate={draft.end_date || draft.start_date}
            divisions={draft.divisions}
            breaks={draft.division_breaks}
            onBreaksChange={(list) =>
              // Each partition adds one more share, so the number of חלוקות
              // always matches what the strip shows.
              setField({ division_breaks: list, divisions: list.length + 1 })
            }
          />
        </div>
      )}
    </div>
  );
}