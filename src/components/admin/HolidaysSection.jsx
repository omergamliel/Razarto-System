import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CalendarDays, Download, Loader2, Plus } from "lucide-react";
import { fetchHolidayGroupsForYears } from "@/components/calendar/useHolidays";
import HolidayRow from "@/components/admin/HolidayRow";
import { holidayDefinitions, resolveHolidayRanges } from "@/lib/holidayRanges";

// No year is fixed in the code: the list holds one DEFINITION per chag (name +
// split) and the dates are resolved from the Hebrew calendar for whatever span
// is being distributed, so importing once is enough for every future year.
const IMPORT_YEARS_AHEAD = 4;
// How far ahead the upcoming dates of each chag are previewed in this section.
const PREVIEW_YEARS_AHEAD = 2;

const toDefinition = (draft) => {
  const name = (draft.name || "").trim();
  const breaks = (draft.division_breaks || []).filter((offset) => Number(offset) > 0);
  const divisions = Math.max(1, Number(draft.divisions) || breaks.length + 1 || 1);
  return {
    name,
    divisions: breaks.length > 0 ? breaks.length + 1 : divisions,
    division_breaks: breaks,
  };
};

// The admin list of holidays that drives shift distribution. Every chag the
// system treats as a togetherness block lives in the Holiday entity — nothing
// is hard-coded — and each holiday carries how many divisions (how many
// different people) its shifts should be split among. Nothing here depends on
// a specific date: a chag is identified by its name in the Hebrew calendar.
export default function HolidaysSection() {
  const queryClient = useQueryClient();
  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ["holidays"],
    queryFn: () => base44.entities.Holiday.list(),
  });

  const [newHoliday, setNewHoliday] = useState({ name: "", divisions: "" });
  const [savingId, setSavingId] = useState(null);

  const previewYears = useMemo(() => {
    const first = new Date().getFullYear();
    return Array.from({ length: PREVIEW_YEARS_AHEAD + 1 }, (_, i) => first + i);
  }, []);

  const importYears = previewYears.slice(0, IMPORT_YEARS_AHEAD + 1);

  const definitions = useMemo(() => holidayDefinitions(holidays), [holidays]);

  // The actual dates of every defined chag, resolved from the Hebrew calendar.
  const { data: ranges = [] } = useQuery({
    queryKey: ["holiday-ranges", previewYears.join(",")],
    queryFn: () => resolveHolidayRanges(definitions, previewYears),
    enabled: definitions.length > 0,
  });

  const rangesByName = useMemo(() => {
    const map = new Map();
    ranges.forEach((range) => {
      const key = range.name.trim();
      map.set(key, [...(map.get(key) || []), range]);
    });
    return map;
  }, [ranges]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["holidays"] });

  // One-time tidy-up of the old per-year list: the same chag was stored once
  // for every year, and now a single definition covers all of them.
  const cleanedRef = useRef(false);
  useEffect(() => {
    if (cleanedRef.current || holidays.length === 0) return;
    cleanedRef.current = true;
    const keep = new Set(definitions.map((definition) => definition.id));
    const stale = holidays.filter((holiday) => !keep.has(holiday.id)).map((holiday) => holiday.id);
    if (stale.length === 0) return;
    base44.entities.Holiday.deleteMany({ id: { $in: stale } })
      .then(refresh)
      .catch(() => {});
  }, [holidays, definitions]);

  const saveMutation = useMutation({
    mutationFn: ({ definition, draft }) =>
      base44.entities.Holiday.update(definition.id, toDefinition(draft)),
    onMutate: ({ definition }) => setSavingId(definition.id),
    onSettled: () => setSavingId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holiday-ranges"] });
      refresh();
      toast.success("החג נשמר");
    },
    onError: () => toast.error("שמירת החג נכשלה"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Holiday.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holiday-ranges"] });
      refresh();
      toast.success("החג נמחק");
    },
    onError: () => toast.error("מחיקת החג נכשלה"),
  });

  const addMutation = useMutation({
    mutationFn: () =>
      base44.entities.Holiday.create({
        name: newHoliday.name.trim(),
        division_breaks: [],
        ...(Number(newHoliday.divisions) > 0
          ? { divisions: Number(newHoliday.divisions) }
          : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holiday-ranges"] });
      refresh();
      setNewHoliday({ name: "", divisions: "" });
      toast.success("החג נוסף");
    },
    onError: () => toast.error("הוספת החג נכשלה"),
  });

  const importMutation = useMutation({
    mutationFn: async (years) => {
      const groups = await fetchHolidayGroupsForYears(years);
      const existing = new Set(definitions.map((definition) => definition.name.trim()));
      const names = [...new Set(groups.map((group) => group.name.trim()))].filter(
        (name) => name && !existing.has(name),
      );
      const toCreate = names.map((name) => ({ name, division_breaks: [] }));
      if (toCreate.length > 0) await base44.entities.Holiday.bulkCreate(toCreate);
      return toCreate.length;
    },
    onSuccess: (added) => {
      queryClient.invalidateQueries({ queryKey: ["holiday-ranges"] });
      refresh();
      toast.success(
        added > 0
          ? `נוספו ${added} חגים מהלוח העברי`
          : "כל החגים בשנים האלה כבר נמצאים ברשימה",
      );
    },
    onError: () => toast.error("ייבוא החגים נכשל"),
  });

  const canAdd = newHoliday.name.trim().length > 0;

  return (
    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-gray-800">חגים</p>
          <p className="text-xs text-gray-500 max-w-xl">
            רשימת החגים שמשפיעה על חלוקת המשמרות — הגדרה כללית לכל חג, ללא
            תלות בתאריכים: כל שורה היא שם החג כפי שהוא מופיע בלוח העברי, והתאריכים
            בפועל נגזרים ממנו בכל שנה מחדש (יום ערב החג נכלל אוטומטית). לכל חג
            קובעים לכמה אנשים שונים תתחלק המשמרת שלו — 1 פירושו שכל החג נשאר אצל
            אותו אדם, 2 פירושו שתי משמרות לאדם — והפס שמתחת לחג מדגים מיד את
            המופע הקרוב: כל צבע הוא אדם אחד, ואפשר לגרור את הגבול שבין שני צבעים
            כדי להעביר משמרת מאחד לשני. החלוקות נשמרות כהיסט ימים מתוך החג, כך
            שהן תקפות בכל שנה. ברירת המחדל היא שתי משמרות לאדם.
          </p>
        </div>
        <CalendarDays className="w-5 h-5 text-blue-500 shrink-0" />
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4" dir="rtl">
        <div className="grid gap-1">
          <Label className="text-sm text-gray-700">
            ייבוא שמות החגים מהלוח העברי
          </Label>
          <p className="text-xs text-gray-500" dir="ltr">
            {`${importYears[0]}–${importYears[importYears.length - 1]}`}
          </p>
        </div>
        <Button
          onClick={() => importMutation.mutate(importYears)}
          disabled={importMutation.isPending}
          className="h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          {importMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          <span>ייבוא</span>
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : definitions.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          אין חגים ברשימה — ייבאו שמות מהלוח העברי או הוסיפו חג ידנית.
        </p>
      ) : (
        <div className="space-y-2 mb-4">
          {definitions.map((definition) => (
            <HolidayRow
              key={definition.id}
              definition={definition}
              occurrences={rangesByName.get(definition.name.trim()) || []}
              isSaving={savingId === definition.id && saveMutation.isPending}
              onSave={(target, draft) => saveMutation.mutate({ definition: target, draft })}
              onDelete={(target) => deleteMutation.mutate(target.id)}
            />
          ))}
        </div>
      )}

      <div
        className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end rounded-xl border border-dashed border-gray-200 px-3 py-3"
        dir="rtl"
      >
        <div className="md:col-span-6 grid gap-1">
          <Label className="text-xs text-gray-500">שם החג</Label>
          <Input
            value={newHoliday.name}
            placeholder="לדוגמה: סוכות"
            onChange={(e) =>
              setNewHoliday((prev) => ({ ...prev, name: e.target.value }))
            }
            className="rounded-xl"
          />
        </div>
        <div className="md:col-span-2 grid gap-1">
          <Label className="text-xs text-gray-500">חלוקות</Label>
          <Input
            type="number"
            min="1"
            step="1"
            placeholder="אוטומטי · 2 משמרות לאדם"
            value={newHoliday.divisions}
            onChange={(e) =>
              setNewHoliday((prev) => ({ ...prev, divisions: e.target.value }))
            }
            className="rounded-xl"
          />
        </div>
        <Button
          onClick={() => addMutation.mutate()}
          disabled={!canAdd || addMutation.isPending}
          className="md:col-span-4 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          {addMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          <span>הוסף חג</span>
        </Button>
      </div>
    </div>
  );
}