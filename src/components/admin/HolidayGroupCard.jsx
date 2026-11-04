import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Check, GripVertical, Loader2, Trash2, X } from "lucide-react";
import HolidayDivisionsStrip from "./HolidayDivisionsStrip";
import { defaultDivisions, holidayDayKeys } from "@/lib/holidayDivisions";
import { firstDateOf } from "./holidayGroups";

const formatDay = (key) =>
  key ? format(new Date(`${key}T00:00:00`), "dd/MM/yyyy") : "";

const isAdded = (definition) => !!String(definition?.date || "").slice(0, 10);

// One card of the holiday list: a manual group of holiday entries (or a single
// ungrouped entry). The entries can be dragged onto another card to join its
// group, the group can be named, and the strip at the bottom sets how the
// group's shifts are divided between people — the same strip every holiday
// used to have, now covering the whole group.
export default function HolidayGroupCard({
  card,
  isSaving,
  onSave,
  onDeleteMember,
  onUngroup,
  onDropMember,
}) {
  const dayKeys = useMemo(
    () => (card.window ? holidayDayKeys(card.window.start, card.window.end) : []),
    [card.window?.start, card.window?.end],
  );

  const config = useMemo(
    () =>
      card.members.find((member) => Number(member.definition.divisions) > 0)?.definition ||
      card.members[0]?.definition ||
      {},
    [card],
  );

  const savedDivisions = Math.max(
    1,
    Number(config.divisions) || defaultDivisions(dayKeys.length),
  );
  const savedBreaks = useMemo(
    () => (config.division_breaks || []).map((offset) => dayKeys[Number(offset)]).filter(Boolean),
    [config, dayKeys],
  );

  const [draft, setDraft] = useState({
    name: card.key,
    divisions: savedDivisions,
    breaks: savedBreaks,
  });
  const [isOver, setIsOver] = useState(false);

  const syncKey = `${card.key}|${savedDivisions}|${savedBreaks.join(",")}|${card.members
    .map((member) => member.definition.id)
    .join(",")}`;
  useEffect(() => {
    setDraft({ name: card.key, divisions: savedDivisions, breaks: savedBreaks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  const groupName = draft.name.trim();
  const changed =
    (card.isGroup && groupName !== card.key) ||
    Number(draft.divisions) !== savedDivisions ||
    draft.breaks.join("|") !== savedBreaks.join("|");

  const handleDrop = (event) => {
    event.preventDefault();
    setIsOver(false);
    const draggedId = event.dataTransfer.getData("text/plain");
    if (draggedId) onDropMember(draggedId, card.key);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
      className={`rounded-xl border px-3 py-2 transition-colors ${
        isOver ? "border-blue-400 bg-blue-50/70" : "border-gray-100 bg-gray-50"
      }`}
      dir="rtl"
    >
      <div className="flex flex-wrap items-center gap-2">
        {card.isGroup ? (
          <Input
            value={draft.name}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, name: event.target.value }))
            }
            placeholder="שם הקבוצה"
            title="שם הקבוצה — כך היא תופיע בחלוקת המשמרות"
            className="h-8 w-44 rounded-lg text-sm"
          />
        ) : (
          <span className="text-sm font-medium text-gray-800">
            {card.members[0]?.definition.name}
          </span>
        )}

        {card.isGroup && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
            {card.members.length} חגים בקבוצה
          </span>
        )}

        {card.window && (
          <span className="text-[11px] text-gray-500" dir="ltr">
            {formatDay(card.window.start)} – {formatDay(card.window.end)}
          </span>
        )}

        {!card.window && (
          <span className="flex items-center gap-1 text-[11px] text-amber-700">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            לא נמצא בלוח העברי — לא ייכלל בחלוקה
          </span>
        )}

        <div className="ms-auto flex items-center gap-2">
          <div className="grid gap-0.5">
            <Label className="text-[10px] text-gray-500">חלוקות</Label>
            <Input
              type="number"
              min="1"
              step="1"
              value={draft.divisions}
              title="1 = כל הקבוצה לאדם אחד, 2 = שתי משמרות לאדם"
              onChange={(event) =>
                // Changing the number re-splits the group evenly, discarding
                // the partitions that were dragged by hand.
                setDraft((prev) => ({ ...prev, divisions: event.target.value, breaks: [] }))
              }
              className="h-8 w-16 rounded-lg text-sm"
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            title="שמור"
            disabled={!changed || isSaving}
            onClick={() =>
              onSave(card, {
                groupName: card.isGroup ? groupName || card.key : "",
                divisions: Math.max(1, Number(draft.divisions) || 1),
                breaks: draft.breaks
                  .map((key) => dayKeys.indexOf(key))
                  .filter((index) => index > 0),
              })
            }
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4 text-green-600" />
            )}
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {card.members.map((member) => {
          const date = firstDateOf(member);
          return (
            <div
              key={member.definition.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", member.definition.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              title="גררו חג על חג אחר כדי לקבץ אותם"
              className={`flex cursor-grab items-center gap-1 rounded-lg border bg-white px-2 py-1 text-[11px] ${
                isAdded(member.definition)
                  ? "border-amber-300 bg-amber-50"
                  : "border-gray-200"
              }`}
            >
              <GripVertical className="w-3 h-3 shrink-0 text-gray-400" />
              <span className="font-medium text-gray-700">{member.definition.name}</span>
              {date && (
                <span className="text-gray-500" dir="ltr">
                  {formatDay(date)}
                </span>
              )}
              {isAdded(member.definition) && (
                <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                  נוסף
                </span>
              )}
              {card.isGroup && (
                <button
                  type="button"
                  title="הוצא מהקבוצה"
                  onClick={() => onUngroup(card, member.definition.id)}
                >
                  <X className="w-3 h-3 text-gray-400 hover:text-gray-700" />
                </button>
              )}
              <button
                type="button"
                title="מחק"
                onClick={() => onDeleteMember(member.definition.id)}
              >
                <Trash2 className="w-3 h-3 text-red-400 hover:text-red-600" />
              </button>
            </div>
          );
        })}
      </div>

      {dayKeys.length > 1 && (
        <div className="mt-2">
          <HolidayDivisionsStrip
            startDate={card.window.start}
            endDate={card.window.end}
            divisions={draft.divisions}
            breaks={draft.breaks}
            onBreaksChange={(list) =>
              // Each partition adds one more share, so the number of חלוקות
              // always matches what the strip shows.
              setDraft((prev) => ({ ...prev, breaks: list, divisions: list.length + 1 }))
            }
          />
        </div>
      )}
    </div>
  );
}