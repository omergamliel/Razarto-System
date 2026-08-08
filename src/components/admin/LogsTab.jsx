import React, { useMemo, useState } from "react";
import { Search, CalendarDays, Circle } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LOG_TYPE_OPTIONS } from "@/components/admin/adminConstants";

export default function LogsTab() {
  const [logFilters, setLogFilters] = useState({
    search: "",
    date: "",
    type: "all",
  });

  const logEntries = useMemo(() => [], []);
  const logTypeOptions = LOG_TYPE_OPTIONS;

  const statusColors = {
    ok: "bg-emerald-500",
    warn: "bg-amber-400",
    error: "bg-rose-500",
  };

  const filteredLogs = logEntries.filter((entry) => {
    const matchesSearch =
      entry.action.toLowerCase().includes(logFilters.search.toLowerCase()) ||
      entry.user.toLowerCase().includes(logFilters.search.toLowerCase());
    const matchesDate = !logFilters.date || entry.date === logFilters.date;
    const matchesType =
      logFilters.type === "all" || entry.type === logFilters.type;
    return matchesSearch && matchesDate && matchesType;
  });

  return (
    <div className="space-y-3 md:space-y-4 overflow-y-auto">
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-800">
              פילטרים
            </p>
            <p className="text-xs text-gray-500">
              חיפוש, תאריכים וסוג פעולה
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-emerald-600">
            <Circle className="w-2.5 h-2.5 fill-emerald-500 text-emerald-500" />{" "}
            לוגים עדכניים
          </div>
        </div>
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-3"
          dir="rtl"
        >
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="חיפוש טקסט חופשי"
              value={logFilters.search}
              onChange={(e) =>
                setLogFilters((prev) => ({
                  ...prev,
                  search: e.target.value,
                }))
              }
              className="pr-9 rounded-xl"
            />
          </div>
          <div className="relative">
            <CalendarDays className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="date"
              value={logFilters.date}
              onChange={(e) =>
                setLogFilters((prev) => ({
                  ...prev,
                  date: e.target.value,
                }))
              }
              className="pr-9 rounded-xl"
            />
          </div>
          <Select
            value={logFilters.type}
            onValueChange={(val) =>
              setLogFilters((prev) => ({ ...prev, type: val }))
            }
          >
            <SelectTrigger className="rounded-xl">
              <SelectValue placeholder="בחר סוג פעולה" />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="all">הכל</SelectItem>
              {logTypeOptions.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">משתמש</th>
                <th className="px-4 py-3 font-semibold">פעולה</th>
                <th className="px-4 py-3 font-semibold">תאריך</th>
                <th className="px-4 py-3 font-semibold">שעה</th>
                <th className="px-4 py-3 font-semibold">סוג פעולה</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredLogs.slice(0, 10).map((log, idx) => (
                <tr
                  key={`${log.user}-${idx}`}
                  className="text-sm hover:bg-gray-50/60"
                >
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-2 text-xs font-semibold ${log.status === "ok" ? "text-emerald-600" : log.status === "warn" ? "text-amber-600" : "text-rose-600"}`}
                    >
                      <span
                        className={`w-3 h-3 rounded-full ${statusColors[log.status]} animate-pulse`}
                      />
                      {log.status === "ok"
                        ? "תקין"
                        : log.status === "warn"
                          ? "חריג"
                          : "אסור"}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-800">
                    {log.user}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {log.action}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {log.displayDate}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {log.time}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {log.type}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-500 flex justify-between px-6">
          <span>
            מציג {filteredLogs.slice(0, 10).length} מתוך{" "}
            {filteredLogs.length}
          </span>
          <span className="hidden md:inline">עד 10 רשומות בעמוד</span>
        </div>
      </div>
    </div>
  );
}