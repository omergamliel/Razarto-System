import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { format, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { he } from "date-fns/locale";

const DEPARTMENT_LABELS = {
  א: "מחלקה א",
  מ: "מחלקה מ",
  ת: "מחלקה ת",
};

export default function FairnessMatrixModal({ isOpen, onClose, currentUser }) {
  const today = new Date();
  const [startDate, setStartDate] = useState(
    format(startOfMonth(today), "yyyy-MM-dd"),
  );
  const [endDate, setEndDate] = useState(
    format(endOfMonth(today), "yyyy-MM-dd"),
  );
  const [tab, setTab] = useState("users"); // "users" | "departments"

  const { data: shifts = [], isLoading: isShiftsLoading } = useQuery({
    queryKey: ["shifts"],
    queryFn: () => base44.entities.Shift.list(),
    enabled: isOpen,
  });

  const { data: people = [], isLoading: isPeopleLoading } = useQuery({
    queryKey: ["all-users"],
    queryFn: () => base44.entities.AuthorizedPerson.list(),
    enabled: isOpen,
  });

  const isLoading = isShiftsLoading || isPeopleLoading;

  const stats = useMemo(() => {
    if (!shifts.length || !people.length) {
      return { users: [], departments: [], maxCount: 0 };
    }

    // Only users with the active 'RR' role are counted (AuthorizedPerson.role,
    // separate from permissions) — people blocked from taking shifts (role
    // 'None') are excluded from the fairness picture entirely.
    const rrPeople = people.filter((p) => (p.role || "RR") === "RR");

    const personBySerial = new Map();
    rrPeople.forEach((p) => {
      if (p.serial_id != null) personBySerial.set(p.serial_id, p);
    });
    const rrSerialIds = new Set(rrPeople.map((p) => p.serial_id));

    const inRange = shifts.filter((s) => {
      const d = s.start_date;
      return d && d >= startDate && d <= endDate;
    });

    const userCounts = new Map(); // serial_id -> count
    const deptCounts = new Map(); // department -> count

    inRange.forEach((s) => {
      const owner = s.original_user_id;
      if (owner == null) return;
      // Skip shifts owned by people who aren't RR.
      if (!rrSerialIds.has(owner)) return;
      userCounts.set(owner, (userCounts.get(owner) || 0) + 1);

      const person = personBySerial.get(owner);
      const dept = person?.department;
      if (dept) {
        deptCounts.set(dept, (deptCounts.get(dept) || 0) + 1);
      }
    });

    const users = rrPeople
      .map((p) => ({
        id: p.id,
        name: p.full_name || "לא ידוע",
        department: p.department,
        count: userCounts.get(p.serial_id) || 0,
        isMe: currentUser && p.serial_id === currentUser.serial_id,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "he"));

    const myDepartment = currentUser?.department;
    const departments = Array.from(deptCounts.entries())
      .map(([dept, count]) => ({
        dept,
        label: DEPARTMENT_LABELS[dept] || `מחלקה ${dept}`,
        count,
        isMine: myDepartment && dept === myDepartment,
      }))
      .sort((a, b) => b.count - a.count);

    const maxCount = Math.max(
      ...users.map((u) => u.count),
      ...departments.map((d) => d.count),
      1,
    );

    return { users, departments, maxCount };
  }, [shifts, people, startDate, endDate]);

  const setRangeToCurrentMonth = () => {
    setStartDate(format(startOfMonth(today), "yyyy-MM-dd"));
    setEndDate(format(endOfMonth(today), "yyyy-MM-dd"));
  };

  if (!isOpen) return null;

  const totalInRange = stats.users.reduce((sum, u) => sum + u.count, 0);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" dir="rtl">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600 p-5 md:p-6 text-white relative shrink-0">
            <button
              onClick={onClose}
              className="absolute top-4 left-4 p-2 rounded-full hover:bg-white/20 transition-colors z-10"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="p-2.5 md:p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                <Scale className="w-6 h-6 md:w-7 md:h-7" />
              </div>
              <div>
                <h2 className="text-2xl md:text-3xl font-bold mb-0.5">
                  טבלת צדק
                </h2>
                <p className="text-white/90 text-xs md:text-sm">
                  כמות משמרות לכל משתמש ומחלקה בטווח שנבחר
                </p>
              </div>
            </div>
          </div>

          {/* Controls: date range + tabs */}
          <div className="p-4 md:p-5 border-b border-gray-100 shrink-0 space-y-3">
            <div className="flex flex-wrap items-end gap-3" dir="rtl">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">תאריך התחלה</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
                  dir="ltr"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">תאריך סיום</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
                  dir="ltr"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={setRangeToCurrentMonth}
                className="rounded-xl h-9"
              >
                החודש הנוכחי
              </Button>
              <div className="text-xs text-gray-500 mr-auto self-end pb-2">
                סה"כ משמרות בטווח: <span className="font-bold text-gray-800">{totalInRange}</span>
              </div>
            </div>

            <div className="flex items-center bg-gray-100 rounded-xl p-1">
              <button
                onClick={() => setTab("users")}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === "users"
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                לפי משתמש
              </button>
              <button
                onClick={() => setTab("departments")}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === "departments"
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                לפי מחלקה
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-4 md:p-6 overflow-y-auto flex-1">
            {isLoading ? (
              <div className="text-center py-10 text-gray-500">טוען נתונים...</div>
            ) : tab === "users" ? (
              stats.users.length === 0 ? (
                <div className="text-center py-10 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                  <p className="text-gray-500 font-medium">אין משמרות בטווח שנבחר</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {stats.users.map((u, idx) => (
                    <div
                      key={u.id}
                      className={`flex items-center gap-3 rounded-xl p-3 border transition-colors ${
                        u.isMe
                          ? "bg-blue-50 border-blue-300 ring-1 ring-blue-200"
                          : "bg-gray-50 border-gray-100"
                      }`}
                    >
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-gray-800 text-sm truncate">
                            {u.name}
                          </span>
                          <span className="text-sm font-bold text-gray-700 shrink-0">
                            {u.count}
                          </span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-gray-200 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-l from-blue-400 to-indigo-500 rounded-full transition-all"
                            style={{ width: `${(u.count / stats.maxCount) * 100}%` }}
                          />
                        </div>
                        {u.department && (
                          <span className="text-[10px] text-gray-400">
                            {DEPARTMENT_LABELS[u.department] || `מחלקה ${u.department}`}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : stats.departments.length === 0 ? (
              <div className="text-center py-10 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                <p className="text-gray-500 font-medium">אין משמרות בטווח שנבחר</p>
              </div>
            ) : (
              <div className="space-y-2">
                {stats.departments.map((d, idx) => (
                  <div
                    key={d.dept}
                    className={`flex items-center gap-3 rounded-xl p-3 border transition-colors ${
                      d.isMine
                        ? "bg-indigo-50 border-indigo-300 ring-1 ring-indigo-200"
                        : "bg-gray-50 border-gray-100"
                    }`}
                  >
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-gray-800 text-sm truncate">
                          {d.label}
                        </span>
                        <span className="text-sm font-bold text-gray-700 shrink-0">
                          {d.count}
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-l from-indigo-400 to-purple-500 rounded-full transition-all"
                          style={{ width: `${(d.count / stats.maxCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-4 shrink-0 border-t border-gray-100">
            <Button
              onClick={onClose}
              variant="outline"
              className="mx-auto flex w-full max-w-[180px] items-center justify-center rounded-xl border-2 px-4 py-3 text-base font-semibold"
            >
              סגור
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}