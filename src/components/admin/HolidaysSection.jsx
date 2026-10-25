import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CalendarDays, Download, Loader2, Plus } from "lucide-react";
import { fetchHolidayGroupsForYear } from "@/components/calendar/useHolidays";
import HolidayRow from "@/components/admin/HolidayRow";
import { defaultDivisions, holidayDayCount } from "@/lib/holidayDivisions";

const EMPTY_NEW = { name: "", start_date: "", end_date: "", divisions: "" };

// A holiday is stored with its split: `divisions` is how many different people
// its shifts go to (an empty field means the default — two shifts per person),
// and `division_breaks` the partitions moved by hand in the strip.
const toPayload = (draft) => {
  const end = draft.end_date || draft.start_date;
  const breaks = (draft.division_breaks || []).filter(Boolean);
  const divisions = Math.max(
    1,
    Number(draft.divisions) ||
      defaultDivisions(holidayDayCount(draft.start_date, end)),
  );
  return {
    name: (draft.name || "").trim(),
    start_date: draft.start_date,
    end_date: end,
    divisions: breaks.length > 0 ? breaks.length + 1 : divisions,
    division_breaks: breaks,
  };
};

// The admin list of holidays that drives shift distribution. Every chag the
// system treats as a togetherness block lives in the Holiday entity — nothing
// is hard-coded — and each holiday carries how many divisions (how many
// different people) its shifts should be split among.
export default function HolidaysSection({ DateInput }) {
  const queryClient = useQueryClient();
  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ["holidays"],
    queryFn: () => base44.entities.Holiday.list(),
  });

  const [newHoliday, setNewHoliday] = useState(EMPTY_NEW);
  const [importYear, setImportYear] = useState(
    String(new Date().getFullYear()),
  );
  const [savingId, setSavingId] = useState(null);

  const sorted = useMemo(
    () =>
      [...holidays].sort((a, b) =>
        (a.start_date || "").localeCompare(b.start_date || ""),
      ),
    [holidays],
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["holidays"] });

  const saveMutation = useMutation({
    mutationFn: ({ holiday, draft }) =>
      base44.entities.Holiday.update(holiday.id, toPayload(draft)),
    onMutate: ({ holiday }) => setSavingId(holiday.id),
    onSettled: () => setSavingId(null),
    onSuccess: () => {
      refresh();
      toast.success("החג נשמר");
    },
    onError: () => toast.error("שמירת החג נכשלה"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Holiday.delete(id),
    onSuccess: () => {
      refresh();
      toast.success("החג נמחק");
    },
    onError: () => toast.error("מחיקת החג נכשלה"),
  });

  const addMutation = useMutation({
    mutationFn: () => base44.entities.Holiday.create(toPayload(newHoliday)),
    onSuccess: () => {
      refresh();
      setNewHoliday(EMPTY_NEW);
      toast.success("החג נוסף");
    },
    onError: () => toast.error("הוספת החג נכשלה"),
  });

  const importMutation = useMutation({
    mutationFn: async (year) => {
      const groups = await fetchHolidayGroupsForYear(year);
      const existing = new Set(sorted.map((holiday) => holiday.start_date));
      const toCreate = groups
        .filter((group) => !existing.has(group.start_date))
        .map((group) => ({
          ...group,
          // Default split: two shifts per person.
          divisions: defaultDivisions(
            holidayDayCount(group.start_date, group.end_date),
          ),
          division_breaks: [],
        }));
      if (toCreate.length > 0)
        await base44.entities.Holiday.bulkCreate(toCreate);
      return toCreate.length;
    },
    onSuccess: (added) => {
      refresh();
      toast.success(
        added > 0
          ? `נוספו ${added} חגים מהלוח העברי`
          : "כל חגי השנה כבר נמצאים ברשימה",
      );
    },
    onError: () => toast.error("ייבוא החגים נכשל"),
  });

  const canAdd = newHoliday.name.trim().length > 0 && !!newHoliday.start_date;

  return (
    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-gray-800">חגים</p>
          <p className="text-xs text-gray-500 max-w-xl">
            רשימת החגים שמשפיעה על חלוקת המשמרות: כל חג שמופיע כאן הוא טווח
            התאריכים שהחלוקה מתייחסת אליו, ויום ערב החג נכלל באותו טווח. לכל חג
            קובעים לכמה אנשים שונים תתחלק המשמרת שלו — 1 פירושו שכל החג נשאר אצל
            אותו אדם, 2 פירושו שתי משמרות לאדם — והפס שמתחת לחג מדגים מיד איך
            החלוקות מתפזרות בין האנשים: כל צבע הוא אדם אחד, ואפשר לגרור את
            הגבול שבין שני צבעים כדי להעביר משמרת מאחד לשני. ברירת המחדל היא
            שתי משמרות לאדם. חגים ארוכים מיום אחד מסומנים. הרשימה אינה קבועה
            בקוד: מייבאים שנה מהלוח העברי או מוסיפים חג ידנית.
          </p>
        </div>
        <CalendarDays className="w-5 h-5 text-blue-500 shrink-0" />
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4" dir="rtl">
        <div className="grid gap-1">
          <Label className="text-sm text-gray-700">
            ייבוא חגים מהלוח העברי
          </Label>
          <Input
            type="number"
            dir="ltr"
            value={importYear}
            onChange={(e) => setImportYear(e.target.value)}
            className="rounded-xl w-28"
          />
        </div>
        <Button
          onClick={() => importMutation.mutate(Number(importYear))}
          disabled={importMutation.isPending || !importYear}
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
      ) : sorted.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          אין חגים ברשימה — ייבאו שנה מהלוח העברי או הוסיפו חג ידנית.
        </p>
      ) : (
        <div className="space-y-2 mb-4">
          {sorted.map((holiday) => (
            <HolidayRow
              key={holiday.id}
              holiday={holiday}
              DateInput={DateInput}
              isSaving={savingId === holiday.id && saveMutation.isPending}
              onSave={(target, draft) =>
                saveMutation.mutate({ holiday: target, draft })
              }
              onDelete={(target) => deleteMutation.mutate(target.id)}
            />
          ))}
        </div>
      )}

      <div
        className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end rounded-xl border border-dashed border-gray-200 px-3 py-3"
        dir="rtl"
      >
        <div className="md:col-span-3 grid gap-1">
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
        <div className="md:col-span-3 grid gap-1">
          <Label className="text-xs text-gray-500">מתאריך</Label>
          <DateInput
            value={newHoliday.start_date}
            onChange={(iso) =>
              setNewHoliday((prev) => ({ ...prev, start_date: iso }))
            }
            className="rounded-xl"
          />
        </div>
        <div className="md:col-span-3 grid gap-1">
          <Label className="text-xs text-gray-500">עד תאריך</Label>
          <DateInput
            value={newHoliday.end_date}
            onChange={(iso) =>
              setNewHoliday((prev) => ({ ...prev, end_date: iso }))
            }
            className="rounded-xl"
          />
        </div>
        <div className="md:col-span-1 grid gap-1">
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
          className="md:col-span-2 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-2"
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