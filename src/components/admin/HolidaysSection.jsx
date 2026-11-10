import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import DateFieldIL from "@/components/DateFieldIL";
import { CalendarDays, Download, Loader2, Plus } from "lucide-react";
import { fetchHolidayGroupsForYears } from "@/components/calendar/useHolidays";
import HolidayGroupCard from "@/components/admin/HolidayGroupCard";
import HolidayPool from "@/components/admin/HolidayPool";
import { buildHolidayCards, buildHolidayPool } from "@/components/admin/holidayGroups";
import { holidayDefinitions, resolveHolidayEntries } from "@/lib/holidayRanges";
import { defaultDivisions, previewHolidayShares } from "@/lib/holidayDivisions";

// No year is fixed in the code: the list holds one row per holiday ENTRY (its
// name as it appears in the Hebrew calendar, or a date added by hand) and the
// dates are resolved from the calendar for whatever span is needed, so one
// setup works for every future year.
const PREVIEW_YEARS_AHEAD = 2;
const IMPORT_YEARS_AHEAD = 4;

const normalizeName = (name = "") => String(name || "").trim();

// The holiday list that drives shift distribution. A card is one manual group:
// the days of its next occurrence, the cuts between them and the shares they
// produce. Everything is saved as soon as it is done — dragging a day into a
// group, cutting between two days, renaming a group.
export default function HolidaysSection() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState("");
  const [newHoliday, setNewHoliday] = useState({ name: "", date: "" });

  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ["holidays"],
    queryFn: () => base44.entities.Holiday.list(),
  });

  const previewYears = useMemo(() => {
    const first = new Date().getFullYear();
    return Array.from({ length: PREVIEW_YEARS_AHEAD + 1 }, (_, i) => first + i);
  }, []);
  const importYears = previewYears.slice(0, IMPORT_YEARS_AHEAD + 1);

  const definitions = useMemo(() => holidayDefinitions(holidays), [holidays]);
  const definitionsKey = definitions
    .map(
      (definition) =>
        `${definition.id}:${definition.name}:${definition.date || ""}:${definition.group_name || ""}:${definition.divisions || ""}:${(definition.division_breaks || []).join(".")}`,
    )
    .join("|");

  const { data: calendarEntries = [] } = useQuery({
    queryKey: ["holiday-calendar", previewYears.join(",")],
    queryFn: () => fetchHolidayGroupsForYears(previewYears, { canonical: false }),
  });

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
  const pool = useMemo(
    () => buildHolidayPool(definitions, entriesById, calendarEntries),
    [definitions, entriesById, calendarEntries],
  );
  const poolById = useMemo(() => new Map(pool.map((item) => [item.id, item])), [pool]);
  const rowById = useMemo(() => new Map(holidays.map((row) => [row.id, row])), [holidays]);

  const refresh = () => {
    ["holidays", "holiday-entries", "holiday-calendar", "holiday-ranges"].forEach((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    );
  };

  const run = async (key, action) => {
    setBusyKey(key);
    setError("");
    try {
      await action();
      refresh();
      return true;
    } catch (err) {
      setError(err?.message || "הפעולה נכשלה");
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const writeRows = (rows, values, key) =>
    run(key, () =>
      base44.entities.Holiday.bulkUpdate(
        rows.map((member) => ({ id: member.definition.id, ...values })),
      ),
    );

  const moveToGroup = async (item, groupName) => {
    const ok = item.definitionId
      ? await run(`move-${item.id}`, () =>
          base44.entities.Holiday.update(item.definitionId, { group_name: groupName }),
        )
      : await run(`move-${item.id}`, () =>
          base44.entities.Holiday.create({
            name: item.name,
            group_name: groupName,
            division_breaks: [],
          }),
        );
    if (ok) setSelectedId(null);
  };

  // A day dragged back out of a group: that row stands on its own again.
  const ungroupRow = (rowId) => {
    if (!rowById.has(rowId)) return;
    run(`ungroup-row-${rowId}`, () =>
      base44.entities.Holiday.update(rowId, { group_name: "" }),
    );
  };

  const handleCardDrop = (card, droppedId) => {
    const id = droppedId || selectedId;
    if (!id) return;
    const item = poolById.get(id);
    if (!item) return;
    moveToGroup(item, card.key);
  };

  const handlePoolDrop = (droppedId) => {
    if (droppedId) ungroupRow(droppedId);
  };

  const createGroup = () => {
    const item = poolById.get(selectedId);
    if (!item) {
      setError("בחרו קודם יום מהרשימה כדי לפתוח קבוצה חדשה");
      return;
    }
    let name = "קבוצה חדשה";
    let suffix = 2;
    while (cards.some((card) => card.key === name)) name = `קבוצה חדשה ${suffix++}`;
    moveToGroup(item, name);
  };

  const renameGroup = (card, name) =>
    writeRows(card.members, { group_name: name }, `rename-${card.key}`);

  const ungroupCard = (card) =>
    writeRows(card.members, { group_name: "" }, `release-${card.key}`);

  const toggleCut = (card, dayKey) => {
    const cuts = card.breaks.includes(dayKey)
      ? card.breaks.filter((key) => key !== dayKey)
      : [...card.breaks, dayKey];
    const offsets = cuts
      .map((key) => card.dayKeys.indexOf(key))
      .filter((offset) => offset > 0)
      .sort((a, b) => a - b);
    const shares = previewHolidayShares(card.dayKeys, {
      divisions: card.divisions,
      breaks: cuts,
    });
    return writeRows(
      card.members,
      { division_breaks: offsets, divisions: Math.max(1, shares.length) },
      `cut-${card.key}`,
    );
  };

  const autoSplit = (card) =>
    writeRows(
      card.members,
      {
        division_breaks: [],
        divisions: defaultDivisions(card.dayKeys.length || 1),
      },
      `auto-${card.key}`,
    );

  const addHoliday = () => {
    const name = normalizeName(newHoliday.name);
    if (!name || !newHoliday.date) return;
    if (definitions.some((definition) => normalizeName(definition.name) === name)) {
      setError("כבר קיים חג בשם הזה");
      return;
    }
    run("add", async () => {
      await base44.entities.Holiday.create({
        name,
        date: newHoliday.date,
        group_name: "",
        division_breaks: [],
      });
      setNewHoliday({ name: "", date: "" });
    });
  };

  const importHolidays = () =>
    run("import", async () => {
      const entriesForYears = await fetchHolidayGroupsForYears(importYears, {
        canonical: false,
      });
      const taken = new Set(
        definitions.map((definition) => normalizeName(definition.name)),
      );
      const toCreate = [];
      entriesForYears.forEach((entry) => {
        const name = normalizeName(entry.name);
        if (!name || taken.has(name)) return;
        taken.add(name);
        toCreate.push({ name, group_name: "", division_breaks: [] });
      });
      if (toCreate.length > 0) await base44.entities.Holiday.bulkCreate(toCreate);
    });

  const canAdd = normalizeName(newHoliday.name).length > 0 && !!newHoliday.date;
  const selectedItem = poolById.get(selectedId);

  return (
    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-800">חגים</p>
          <p className="text-xs text-gray-500 max-w-2xl">
            גררו יום בין קבוצות או חזרה לרשימת הימים שלא בקבוצה. בטלפון: הקישו על
            יום ואז על הקבוצה. שם קבוצה נשמר ביציאה מהשדה. הקווים בין הימים הם
            החיתוכים בין המנות — לחצו על קו כדי לחתוך או לחבר. כל מנה היא לכל
            היותר שני ימים, ושישי לא נחתך מהשבת שאחריו.
          </p>
        </div>
        <CalendarDays className="w-5 h-5 text-blue-500 shrink-0" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Button
          onClick={createGroup}
          disabled={busyKey === "create" || !selectedItem}
          className="h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <span>קבוצה חדשה</span>
        </Button>
        <Button
          onClick={importHolidays}
          disabled={busyKey === "import"}
          variant="outline"
          className="h-9 rounded-xl gap-1.5"
        >
          {busyKey === "import" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          <span>
            ייבוא שמות מהלוח ({importYears[0]}–{importYears[importYears.length - 1]})
          </span>
        </Button>
        <span className="text-xs text-gray-500">
          {selectedItem
            ? `נבחר ${selectedItem.name}: הקישו על קבוצה או על הרשימה כדי להעביר אותו.`
            : ""}
        </span>
      </div>

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {isLoading || isLoadingEntries ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-3 items-start">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {cards.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6 sm:col-span-2 xl:col-span-3">
                אין קבוצות — גררו יום מהרשימה אל קבוצה חדשה.
              </p>
            ) : (
              cards.map((card, index) => (
                <HolidayGroupCard
                  key={card.key}
                  card={card}
                  index={index}
                  isBusy={busyKey?.endsWith(card.key)}
                  isTarget={!!selectedItem}
                  onRename={renameGroup}
                  onToggleCut={toggleCut}
                  onAuto={autoSplit}
                  onUngroup={ungroupCard}
                  onDropItem={(droppedId) => handleCardDrop(card, droppedId)}
                />
              ))
            )}
          </div>
          <HolidayPool
            items={pool}
            selectedId={selectedId}
            busyId={busyKey}
            onSelect={setSelectedId}
            onReturn={handlePoolDrop}
          />
        </div>
      )}

      <div
        className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end rounded-xl border border-dashed border-gray-200 px-3 py-3 mt-4"
        dir="rtl"
      >
        <div className="md:col-span-5 grid gap-1">
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
        <div className="md:col-span-4 grid gap-1">
          <Label className="text-xs text-gray-500">תאריך</Label>
          <DateFieldIL
            value={newHoliday.date}
            onChange={(iso) => setNewHoliday((prev) => ({ ...prev, date: iso }))}
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