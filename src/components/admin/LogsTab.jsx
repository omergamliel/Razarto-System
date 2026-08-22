import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, CalendarDays, Circle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { LOG_TYPE_OPTIONS } from "@/components/admin/adminConstants";

const PAGE_SIZE = 50;

// Map an ActivityLog row (base44 entity) into the shape the table renders,
// deriving the display date/time from the system created_date timestamp.
function toEntry(log) {
  const ts = log.created_date || log.updated_date;
  const parsed = ts ? new Date(ts) : null;
  const valid = parsed && !isNaN(parsed);
  return {
    id: log.id,
    user: log.actor_name || "לא ידוע",
    action: log.action || "",
    type: log.type || "",
    status: log.status || "ok",
    date: valid ? format(parsed, "yyyy-MM-dd") : "",
    displayDate: valid ? format(parsed, "dd/MM/yyyy") : "",
    time: valid ? format(parsed, "HH:mm") : "",
    sortMs: valid ? parsed.getTime() : 0,
  };
}

export default function LogsTab() {
  const [logFilters, setLogFilters] = useState({
    search: "",
    date: "",
    type: "all",
  });

  const { data: rawLogs = [], isLoading } = useQuery({
    queryKey: ["activity-logs"],
    queryFn: () => base44.entities.ActivityLog.list(),
    staleTime: 1000 * 30,
  });

  const logTypeOptions = LOG_TYPE_OPTIONS;

  const statusColors = {
    ok: "bg-emerald-500",
    warn: "bg-amber-400",
    error: "bg-rose-500",
  };

  // Newest first — the log's most recent change at the top.
  const logEntries = useMemo(
    () => rawLogs.map(toEntry).sort((a, b) => b.sortMs - a.sortMs),
    [rawLogs],
  );

  const filteredLogs = logEntries.filter((entry) => {
    const term = logFilters.search.toLowerCase();
    const matchesSearch =
      !term ||
      entry.action.toLowerCase().includes(term) ||
      entry.user.toLowerCase().includes(term);
    const matchesDate = !logFilters.date || entry.date === logFilters.date;
    const matchesType =
      logFilters.type === "all" || entry.type === logFilters.type;
    return matchesSearch && matchesDate && matchesType;
  });

  const visibleLogs = filteredLogs.slice(0, PAGE_SIZE);

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
              {isLoading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-gray-400"
                  >
                    <Loader2 className="w-5 h-5 animate-spin inline-block" />
                  </td>
                </tr>
              )}
              {!isLoading && visibleLogs.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-sm text-gray-400"
                  >
                    אין רשומות לוג להצגה
                  </td>
                </tr>
              )}
              {!isLoading &&
                visibleLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="text-sm hover:bg-gray-50/60"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-2 text-xs font-semibold ${log.status === "ok" ? "text-emerald-600" : log.status === "warn" ? "text-amber-600" : "text-rose-600"}`}
                      >
                        <span
                          className={`w-3 h-3 rounded-full ${statusColors[log.status]}`}
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
            מציג {visibleLogs.length} מתוך {filteredLogs.length}
          </span>
          <span className="hidden md:inline">
            עד {PAGE_SIZE} רשומות בעמוד
          </span>
        </div>
      </div>
    </div>
  );
}
