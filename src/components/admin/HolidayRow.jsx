import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Loader2, Trash2 } from "lucide-react";

const draftFrom = (holiday) => ({
  name: holiday.name || "",
  start_date: holiday.start_date || "",
  end_date: holiday.end_date || "",
  divisions: holiday.divisions ?? 1,
});

// One holiday in the admin list: its name and dates, plus "חלוקות" — how many
// different people the holiday's shifts should be split among (1 = the whole
// chag stays with one person). Saving only lights up once something changed.
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
  ]);

  const changed =
    draft.name !== (holiday.name || "") ||
    draft.start_date !== (holiday.start_date || "") ||
    draft.end_date !== (holiday.end_date || "") ||
    Number(draft.divisions || 1) !== Number(holiday.divisions ?? 1);

  const setField = (patch) => setDraft((prev) => ({ ...prev, ...patch }));

  return (
    <div
      className="grid grid-cols-2 md:grid-cols-12 gap-2 items-end rounded-xl border border-gray-100 bg-gray-50 px-3 py-2"
      dir="rtl"
    >
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
          onChange={(iso) => setField({ start_date: iso })}
          className="rounded-xl"
        />
      </div>
      <div className="md:col-span-3 grid gap-1">
        <Label className="text-xs text-gray-500">עד תאריך</Label>
        <DateInput
          value={draft.end_date}
          onChange={(iso) => setField({ end_date: iso })}
          className="rounded-xl"
        />
      </div>
      <div className="md:col-span-2 grid gap-1">
        <Label className="text-xs text-gray-500">חלוקות</Label>
        <Input
          type="number"
          min="1"
          step="1"
          value={draft.divisions}
          onChange={(e) => setField({ divisions: e.target.value })}
          className="rounded-xl"
        />
      </div>
      <div className="flex items-center justify-end gap-1 md:col-span-1">
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
  );
}