import React, { useEffect, useState } from "react";
import { Check, Scissors, X } from "lucide-react";
import HolidayDayChip from "@/components/admin/HolidayDayChip";

const dayDiff = (a, b) =>
  Math.round(
    (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) /
      86400000,
  );

const sharesOfDays = (shares = []) => {
  const map = new Map();
  shares.forEach((share, index) =>
    share.forEach((day) => map.set(day, { index, count: shares.length })),
  );
  return map;
};

// One holiday group: the days of its next occurrence, the cuts between them and
// the shares those cuts produce. A day is dragged in from the list of days that
// are not in a group (or picked there and clicked here).
export default function HolidayGroupCard({
  card,
  index,
  isBusy,
  isTarget,
  onRename,
  onToggleCut,
  onAuto,
  onUngroup,
  onDropItem,
}) {
  const [name, setName] = useState(card.key);
  useEffect(() => setName(card.key), [card.key]);

  const commitName = () => {
    const value = name.trim();
    if (value && value !== card.key) onRename(card, value);
    else setName(card.key);
  };

  const shareOf = sharesOfDays(card.shares);
  // Which holiday row each day comes from — dragging a day back to the list of
  // ungrouped days releases that row from the group.
  const rowOfDay = new Map();
  card.members.forEach((member) =>
    member.days.forEach((day) => rowOfDay.set(day, member.definition.id)),
  );

  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDropItem(event.dataTransfer.getData("text/plain"));
      }}
      onClick={(event) => {
        if (event.target.closest("input, button, a")) return;
        onDropItem(null);
      }}
      className={`bg-white border rounded-2xl p-3 flex flex-col gap-2 transition-colors ${
        isTarget ? "border-blue-400 bg-blue-50/40" : "border-gray-200"
      }`}
      dir="rtl"
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-400 tabular-nums">{index + 1}</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="flex-1 min-w-0 text-sm font-semibold text-gray-800 bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 focus:bg-slate-50 rounded-md px-1.5 py-1 outline-none"
          aria-label="שם הקבוצה"
        />
        {name.trim() !== card.key && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={commitName}
            title="שמור שם"
            className="w-7 h-7 grid place-items-center rounded-md text-emerald-600 hover:bg-emerald-50"
          >
            <Check className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onUngroup(card)}
          disabled={isBusy}
          title="פירוק הקבוצה (הימים חוזרים לרשימה)"
          className="w-7 h-7 grid place-items-center rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {card.dayKeys.length === 0 ? (
        <p className="text-xs text-gray-400 py-3 text-center">
          אין מועד קרוב בלוח העברי
        </p>
      ) : (
        <div className="flex flex-wrap items-stretch gap-y-2">
          {card.dayKeys.map((dayKey, dayIndex) => {
            const previous = card.dayKeys[dayIndex - 1];
            const consecutive = previous && dayDiff(previous, dayKey) === 1;
            const cut = card.breaks.includes(dayKey);
            const share = shareOf.get(dayKey);
            return (
              <React.Fragment key={dayKey}>
                {dayIndex > 0 &&
                  (consecutive ? (
                    <button
                      type="button"
                      onClick={() => onToggleCut(card, dayKey)}
                      disabled={isBusy}
                      title={
                        cut
                          ? "יש חיתוך כאן — לחצו כדי לחבר"
                          : "לחצו כדי לחתוך כאן לאדם נוסף"
                      }
                      aria-pressed={cut}
                      className="w-6 grid place-items-center group disabled:opacity-40"
                    >
                      <span
                        className={`h-[70%] w-[2px] rounded-full ${
                          cut ? "bg-violet-500" : "bg-gray-200 group-hover:bg-blue-400"
                        }`}
                      />
                    </button>
                  ) : (
                    <span className="w-6 grid place-items-center text-xs text-gray-300">
                      …
                    </span>
                  ))}
                <div
                  draggable
                  onDragStart={(event) => {
                    const rowId = rowOfDay.get(dayKey);
                    if (!rowId) return;
                    event.dataTransfer.setData("text/plain", rowId);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <HolidayDayChip
                    dayKey={dayKey}
                    label={card.labels.get(dayKey)}
                    shareCount={share?.count || 0}
                    shareIndex={share?.index ?? -1}
                  />
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500">
        <span>
          {card.dayKeys.length} ימים · {card.shares.length} מנות
        </span>
        <span className="flex items-center gap-1.5">
          {card.manual ? (
            <>
              <Scissors className="w-3.5 h-3.5 text-violet-500" />
              <span>חיתוכים ידניים</span>
              <button
                type="button"
                onClick={() => onAuto(card)}
                disabled={isBusy}
                className="rounded-md border border-gray-200 px-1.5 py-0.5 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40"
              >
                חזרה לאוטומטי
              </button>
            </>
          ) : (
            <span>חיתוכים אוטומטיים</span>
          )}
        </span>
      </div>
    </div>
  );
}