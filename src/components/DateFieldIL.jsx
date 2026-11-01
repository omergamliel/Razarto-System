import React, { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { format, isValid, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

// Parse a typed dd/mm/yyyy (also dd.mm.yyyy / dd-mm-yyyy) into 'yyyy-MM-dd'.
function parseILDate(text) {
  const m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/.exec((text || "").trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const date = new Date(year, month - 1, day);
  const ok =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
  return ok ? format(date, "yyyy-MM-dd") : null;
}

// A date field that always SHOWS dd/MM/yyyy (the Israeli format) regardless of
// the browser locale, while keeping the calendar menu behind the icon. The value
// it emits stays an ISO 'yyyy-MM-dd' string, so callers are unaffected.
export default function DateFieldIL({
  value,
  onChange,
  className = "",
  placeholder = "dd/mm/yyyy",
}) {
  const [open, setOpen] = useState(false);
  // While the user is typing we show exactly what they typed; the ISO value
  // prop takes over again once the field is committed.
  const [draft, setDraft] = useState(null);

  const parsed = value ? parseISO(value) : null;
  const selected = parsed && isValid(parsed) ? parsed : undefined;
  const shown = draft ?? (selected ? format(selected, "dd/MM/yyyy") : "");

  const commit = (text) => {
    setDraft(null);
    if (!text.trim()) {
      onChange("");
      return;
    }
    const iso = parseILDate(text);
    if (iso) onChange(iso);
  };

  return (
    <div
      dir="ltr"
      className={cn(
        "flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3",
        className,
      )}
    >
      <input
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(e.currentTarget.value);
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        inputMode="numeric"
        className="h-10 w-full min-w-0 bg-transparent text-left text-sm tabular-nums text-gray-800 outline-none placeholder:text-gray-400"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="בחירת תאריך"
            className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-600"
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="z-[80] w-auto p-0">
          <Calendar
            mode="single"
            dir="rtl"
            initialFocus
            selected={selected}
            defaultMonth={selected}
            onSelect={(date) => {
              if (date) {
                setDraft(null);
                onChange(format(date, "yyyy-MM-dd"));
              }
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}