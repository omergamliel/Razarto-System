import React from "react";
import { format } from "date-fns";
import { CalendarPlus, GripVertical } from "lucide-react";

const prettyDate = (item) => {
  if (!item.from) return "";
  const from = format(new Date(`${item.from}T00:00:00`), "d/M");
  if (!item.to || item.to === item.from) return from;
  return `${from}–${format(new Date(`${item.to}T00:00:00`), "d/M")}`;
};

// The days that are not in any group: holiday rows that were never grouped, and
// Hebrew-calendar entries that have no row yet (dropping one into a group
// creates it). Drag a chip onto a group, or click it and then click the group.
export default function HolidayPool({ items, selectedId, busyId, onSelect, onReturn }) {
  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onReturn(event.dataTransfer.getData("text/plain"));
      }}
      className="bg-white border border-gray-200 rounded-2xl p-3 flex flex-col gap-2 h-fit lg:sticky lg:top-3 max-h-[70vh] overflow-auto"
      dir="rtl"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-gray-800">ימים שלא בקבוצה</p>
        <span className="text-xs text-gray-400">{items.length} ימים</span>
      </div>
      <p className="text-[11px] leading-relaxed text-gray-500">
        יום חול המועד שאינו בקבוצה נשאר יום חג ומצטרף לחג שלידו. כל יום אחר כאן
        משובץ כיום רגיל.
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400 py-3 text-center">כל הימים בקבוצות</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => {
            const selected = selectedId === item.id;
            const dragging = `drag-${item.id}` === busyId;
            return (
              <button
                key={item.id}
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", item.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onSelect(item.id === selectedId ? null : item.id)}
                aria-pressed={selected}
                title={
                  item.isNew
                    ? "אין רשומה ליום הזה — גרירה לקבוצה תיצור אותה"
                    : "גררו לקבוצה, או הקישו כאן ואז על הקבוצה"
                }
                className={`flex flex-col items-start gap-0.5 rounded-lg border px-2 py-1.5 text-right cursor-grab active:cursor-grabbing ${
                  selected
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 bg-white hover:border-blue-300"
                } ${dragging ? "opacity-40" : ""}`}
              >
                <span className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 tabular-nums">
                  <GripVertical className="w-3 h-3 text-gray-300" />
                  {prettyDate(item)}
                  {item.isNew && <CalendarPlus className="w-3 h-3 text-emerald-500" />}
                </span>
                <span className="text-[11px] text-gray-600">{item.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}