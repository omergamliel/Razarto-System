import React, { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

// A user picker like the "החלפת משתמש למשמרת" dropdown, but with type-to-filter:
// the trigger doubles as a search box (filters by name/email), and clicking a
// row selects that user (value = serial_id). `excludeId` hides one user (so the
// "from"/"to" pair can't pick the same person).
export default function UserComboBox({
  value,
  onChange,
  users,
  placeholder = "בחר משתמש",
  excludeId,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selected = users.find((u) => Number(u.serial_id) === Number(value));
  const term = query.trim().toLowerCase();
  const filtered = users.filter(
    (u) =>
      Number(u.serial_id) !== Number(excludeId) &&
      (term === "" ||
        u.full_name?.toLowerCase().includes(term) ||
        u.email?.toLowerCase().includes(term)),
  );

  return (
    <div className="relative" ref={wrapRef} dir="rtl">
      <Input
        value={open ? query : selected?.full_name || ""}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        className="rounded-xl"
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-center text-sm text-gray-400">
              לא נמצאו משתמשים
            </p>
          ) : (
            filtered.map((u) => (
              <button
                key={u.serial_id}
                type="button"
                onClick={() => {
                  onChange(u.serial_id);
                  setOpen(false);
                  setQuery("");
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm hover:bg-gray-50 ${
                  Number(u.serial_id) === Number(value) ? "bg-blue-50" : ""
                }`}
              >
                <span className="truncate text-gray-800">{u.full_name}</span>
                {u.department && (
                  <span className="shrink-0 text-xs text-gray-400">
                    {u.department}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}