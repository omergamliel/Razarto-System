import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import DateFieldIL from "@/components/DateFieldIL";
import { toast } from "sonner";
import { CalendarDays, Download, Loader2, Plus } from "lucide-react";
import {
  canonicalHolidayName,
  fetchHolidayGroupsForYears,
} from "@/components/calendar/useHolidays";
import HolidayGroupCard from "@/components/admin/HolidayGroupCard";
import { buildHolidayCards } from "@/components/admin/holidayGroups";
import { holidayDefinitions, resolveHolidayEntries } from "@/lib/holidayRanges";

// No year is fixed in the code: the list holds one row per holiday ENTRY (name
// as it appears in the Hebrew calendar, or a date that was added by hand) and
// the dates are resolved from the calendar for whatever span is being
// distributed, so importing once is enough for every future year.
const IMPORT_YEARS_AHEAD = 4;
// How far ahead the upcoming dates of each entry are previewed in this section.
const PREVIEW_YEARS_AHEAD = 2;

const normalizeName = (name = "") => String(name || "").trim();

// The admin list of holidays that drives shift distribution. Entries are shown
// individually and sorted by date; dragging one entry onto another groups them,
// the group gets a name, and the group is what the distribution and the
// fairness table treat as one holiday block — with the same divisions strip
// under it as before.
export default function HolidaysSection() {
  const queryClient = useQueryClient();
  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ["holidays"],
    queryFn: () => base44.entities.Holiday.list(),
  });

  const [newHoliday, setNewHoliday] = useState({ name: "", date: "", divisions: "" });
  const [busyKey, setBusyKey] = useState(null);

  const previewYears = useMemo(() => {
    const first = new Date().getFullYear();
    return Array.from({ length: PREVIEW_YEARS_AHEAD + 1 }, (_, i) => first + i);
  }, []);

  const importYears = previewYears.slice(0, IMPORT_YEARS_AHEAD + 1);

  const definitions = useMemo(() => holidayDefinitions(holidays), [holidays]);
  const definitionsKey = definitions
    .map((definition) => `${definition.id}:${definition.name}:${definition.date || ""}:${definition.group_name || ""}`)
    .join("|");

  // The actual dates of every entry, resolved from the Hebrew calendar.
  const { data: entries = [], isLoading: isLoadingEntries } = useQuery({
    queryKey: ["holiday-entries", previewYears.join(","), definitionsKey],
    queryFn: () => resolveHolidayEntries(definitions, previewYears),
    enabled: definitions.length > 0,
  });

  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.definition.id, entry])),
    [entries],
  );
  const cards = useMemo(
    () => buildHolidayCards(definitions, entriesById),
    [definitions, entriesById],
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["holidays"] });
    queryClient.invalidateQueries({ queryKey: ["holiday-entries"] });
    queryClient.invalidateQueries({ queryKey: ["holiday-ranges"] });
  };

  const run = async (action, key, successMessage) => {
    setBusyKey(key);
    try {
      await action();
      refresh();
      if (successMessage) toast.success(successMessage);
    } catch {
      toast.error("הפעולה נכשלה");
    } finally {
      setBusyKey(null);
    }
  };

  // A chag that is still one row (e.g. "סוכות") is split into its individual
  // calendar entries, kept together as a group under the old name so the
  // divisions already configured for it carry over unchanged.
  const splitRef = useRef(false);
  useEffect(() => {
    if (splitRef.current || entries.length === 0) return;
    splitRef.current = true;
    const grouped = entries.filter((entry) => entry.entryNames.length > 1);
    if (grouped.length === 0) return;
    const replaced = new Set(grouped.map((entry) => entry.definition.id));
    // Names of the rows that stay — the rows being replaced are re-created per
    // entry, so their own name must not block the entry that carries it.
    const taken = new Set(
      holidays
        .filter((holiday) => !replaced.has(holiday.id))
        .map((holiday) => normalizeName(holiday.name)),
    );
    const toCreate = [];
    grouped.forEach((entry) => {
      const definition = entry.definition;
      entry.entryNames.forEach((name) => {
        if (taken.has(name)) return;
        taken.add(name);
        toCreate.push({
          name,
          group_name: normalizeName(definition.name),
          division_breaks: [],
          ...(Number(definition.divisions) > 0
            ? { divisions: Number(definition.divisions) }
            : {}),
        });
      });
    });
    run(async () => {
      if (toCreate.length > 0) await base44.entities.Holiday.bulkCreate(toCreate);
      await base44.entities.Holiday.deleteMany({
        id: { $in: grouped.map((entry) => entry.definition.id) },
      });
    }, "split");
  }, [entries, holidays]);

  const saveCard = (card, { groupName, divisions, breaks }) =>
    run(
      () =>
        base44.entities.Holiday.bulkUpdate(
          card.members.map((member) => ({
            id: member.definition.id,
            group_name: groupName,
            divisions,
            division_breaks: breaks,
          })),
        ),
      `save-${card.key}`,
      "החגים נשמרו",
    );

  const dropMember = (draggedId, targetKey) => {
    const target = cards.find((card) => card.key === targetKey);
    const dragged = holidays.find((holiday) => holiday.id === draggedId);
    if (!target || !dragged) return;
    if (normalizeName(dragged.group_name) === targetKey) return;
    const updates = [];
    target.members.forEach((member) => {
      if (normalizeName(member.definition.group_name) !== targetKey) {
        updates.push({ id: member.definition.id, group_name: targetKey });
      }
    });
    updates.push({ id: draggedId, group_name: targetKey });
    run(() => base44.entities.Holiday.bulkUpdate(updates), `drop-${draggedId}`);
  };

  const ungroup = (card, definitionId) => {
    const remaining = card.members.filter((member) => member.definition.id !== definitionId);
    const updates = [{ id: definitionId, group_name: "" }];
    if (remaining.length === 1) {
      updates.push({ id: remaining[0].definition.id, group_name: "" });
    }
    run(() => base44.entities.Holiday.bulkUpdate(updates), `ungroup-${definitionId}`);
  };

  const addHoliday = () => {
    const name = normalizeName(newHoliday.name);
    if (!name || !newHoliday.date) return;
    if (definitions.some((definition) => normalizeName(definition.name) === name)) {
      toast.error("כבר קיים חג בשם הזה");
      return;
    }
    run(
      async () => {
        await base44.entities.Holiday.create({
          name,
          date: newHoliday.date,
          division_breaks: [],
          ...(Number(newHoliday.divisions) > 0
            ? { divisions: Number(newHoliday.divisions) }
            : {}),
        });
        setNewHoliday({ name: "", date: "", divisions: "" });
      },
      "add",
      "החג נוסף",
    );
  };

  const importHolidays = () =>
    run(
      async () => {
        const entriesForYears = await fetchHolidayGroupsForYears(importYears, {
          canonical: false,
        });
        const taken = new Set(definitions.map((definition) => normalizeName(definition.name)));
        const toCreate = [];
        entriesForYears.forEach((entry) => {
          const name = normalizeName(entry.name);
          if (!name || taken.has(name)) return;
          taken.add(name);
          toCreate.push({
            name,
            group_name: canonicalHolidayName(name),
            division_breaks: [],
          });
        });
        if (toCreate.length > 0) await base44.entities.Holiday.bulkCreate(toCreate);
        toast.success(
          toCreate.length > 0
            ? `נוספו ${toCreate.length} רשומות מהלוח העברי`
            : "כל החגים בשנים האלה כבר נמצאים ברשימה",
        );
      },
      "import",
    );

  const canAdd = normalizeName(newHoliday.name).length > 0 && !!newHoliday.date;

  return (
    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-gray-800">חגים</p>
          <p className="text-xs text-gray-500 max-w-2xl">
            רשימת החגים שמשפיעה על חלוקת המשמרות, ממוינת לפי תאריך. כל שורה היא
            רשומה בודדת מהלוח העברי (למשל "ערב סוכות", "סוכות א׳", "סוכות ב׳
            (חוה״מ)") — גררו רשומה על רשומה אחרת כדי לקבץ אותן, ותנו לקבוצה שם.
            הקבוצה היא הגוש שהחלוקה והצדק מתייחסים אליו, והפס מתחת לקבוצה מדגים
            את המופע הקרוב שלה: כל צבע הוא אדם אחד, ואפשר לגרור את הגבול שבין שני
            צבעים. ברירת המחדל היא שתי משמרות לאדם. רשומה שנוספה ידנית מסומנת
            ומוצג התאריך שלה.
          </p>
        </div>
        <CalendarDays className="w-5 h-5 text-blue-500 shrink-0" />
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4" dir="rtl">
        <div className="grid gap-1">
          <Label className="text-sm text-gray-700">ייבוא שמות החגים מהלוח העברי</Label>
          <p className="text-xs text-gray-500" dir="ltr">
            {`${importYears[0]}–${importYears[importYears.length - 1]}`}
          </p>
        </div>
        <Button
          onClick={importHolidays}
          disabled={busyKey === "import"}
          className="h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          {busyKey === "import" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          <span>ייבוא</span>
        </Button>
      </div>

      {isLoading || isLoadingEntries ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : cards.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          אין חגים ברשימה — ייבאו שמות מהלוח העברי או הוסיפו חג ידנית.
        </p>
      ) : (
        <div className="space-y-2 mb-4">
          {cards.map((card) => (
            <HolidayGroupCard
              key={card.key}
              card={card}
              isSaving={busyKey === `save-${card.key}`}
              onSave={saveCard}
              onDropMember={dropMember}
              onUngroup={ungroup}
              onDeleteMember={(id) =>
                run(
                  () => base44.entities.Holiday.delete(id),
                  `delete-${id}`,
                  "הרשומה נמחקה",
                )
              }
            />
          ))}
        </div>
      )}

      <div
        className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end rounded-xl border border-dashed border-gray-200 px-3 py-3"
        dir="rtl"
      >
        <div className="md:col-span-4 grid gap-1">
          <Label className="text-xs text-gray-500">שם החג</Label>
          <Input
            value={newHoliday.name}
            placeholder="לדוגמה: יום הולדת החטיבה"
            onChange={(event) =>
              setNewHoliday((prev) => ({ ...prev, name: event.target.value }))
            }
            className="rounded-xl"
          />
        </div>
        <div className="md:col-span-3 grid gap-1">
          <Label className="text-xs text-gray-500">תאריך</Label>
          <DateFieldIL
            value={newHoliday.date}
            onChange={(iso) => setNewHoliday((prev) => ({ ...prev, date: iso }))}
            className="rounded-xl"
          />
        </div>
        <div className="md:col-span-2 grid gap-1">
          <Label className="text-xs text-gray-500">חלוקות</Label>
          <Input
            type="number"
            min="1"
            step="1"
            placeholder="אוטומטי"
            value={newHoliday.divisions}
            onChange={(event) =>
              setNewHoliday((prev) => ({ ...prev, divisions: event.target.value }))
            }
            className="rounded-xl"
          />
        </div>
        <Button
          onClick={addHoliday}
          disabled={!canAdd || busyKey === "add"}
          className="md:col-span-3 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          {busyKey === "add" ? (
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