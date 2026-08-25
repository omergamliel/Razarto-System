import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Scale, CalendarHeart } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConsiderationPanel from "./ConsiderationPanel";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { resolveOwnerId } from "@/components/calendar/whatsappTemplates";
import { isActiveGroupMember } from "@/lib/utils";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
} from "date-fns";

const DEPARTMENT_LABELS = {
  א: "מחלקה א",
  מ: "מחלקה מ",
  ת: "מחלקה ת",
};

export default function FairnessMatrixModal({
  isOpen,
  onClose,
  currentUser,
  isAdmin = false,
}) {
  const today = new Date();
  const [startDate, setStartDate] = useState(
    format(startOfMonth(today), "yyyy-MM-dd"),
  );
  const [endDate, setEndDate] = useState(
    format(endOfMonth(today), "yyyy-MM-dd"),
  );
  const [tab, setTab] = useState("groups"); // "groups" | "users" — groups is the default
  // Top-level tab: the fairness matrix vs. the consideration (התחשבות) tool.
  const [mode, setMode] = useState("fairness"); // "fairness" | "consideration"

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

  // Ownership lives in the base "assignment" ShiftCoverage row (Phase 4), so
  // the fairness tally reads the owner from coverage, not Shift.original_user_id.
  const { data: coverages = [] } = useQuery({
    queryKey: ["coverages"],
    queryFn: () => base44.entities.ShiftCoverage.list(),
    enabled: isOpen,
  });

  // Group definitions / active-member records — used to group the fairness view
  // by קבוצה and to surface each group's active member first.
  const { data: shiftGroups = [] } = useQuery({
    queryKey: ["shift-groups"],
    queryFn: () => base44.entities.ShiftGroup.list(),
    enabled: isOpen,
  });

  const isLoading = isShiftsLoading || isPeopleLoading;

  const stats = useMemo(() => {
    if (!shifts.length || !people.length) {
      return { users: [], groups: [], maxCount: 0 };
    }

    // Every authorized person is part of the fairness picture. Who actually
    // takes shifts is governed by the ShiftGroup active-member rule (surfaced
    // below by ordering each group's active member first), so there is no
    // longer a separate per-person flag to filter on.
    const rrPeople = people;

    const personBySerial = new Map();
    rrPeople.forEach((p) => {
      if (p.serial_id != null) personBySerial.set(p.serial_id, p);
    });
    const rrSerialIds = new Set(rrPeople.map((p) => p.serial_id));

    // The rota has exactly one shift per calendar day, so a day must be counted
    // once. Guard against duplicate Shift rows for the same date (which would
    // otherwise inflate the total, e.g. 32 in a 31-day month) by keeping only
    // the first shift seen per date within the range.
    const inRange = shifts.filter((s) => {
      const d = s.start_date;
      return d && d >= startDate && d <= endDate;
    });
    const seenDates = new Set();
    const dedupedInRange = inRange.filter((s) => {
      if (seenDates.has(s.start_date)) return false;
      seenDates.add(s.start_date);
      return true;
    });

    const userCounts = new Map(); // serial_id -> count

    dedupedInRange.forEach((s) => {
      const owner = resolveOwnerId(s, coverages);
      if (owner == null) return;
      // Skip shifts owned by people not in the authorized list.
      if (!rrSerialIds.has(owner)) return;
      userCounts.set(owner, (userCounts.get(owner) || 0) + 1);
    });

    const users = rrPeople
      .map((p) => ({
        id: p.id,
        name: p.full_name || "לא ידוע",
        department: p.department,
        count: userCounts.get(p.serial_id) || 0,
        isMe: currentUser && p.serial_id === currentUser.serial_id,
      }))
      .sort((a, b) => {
        // Current user (if RR and present) always floats to the top.
        if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
        return b.count - a.count || a.name.localeCompare(b.name, "he");
      });

    // Group the same RR people by their קבוצה (`sign`). Each group's shift
    // count is the sum of its members' counts, and its member list is ordered
    // active-member-first so the person currently taking shifts shows up first.
    const groupsMap = new Map(); // symbol -> { members: [], count }
    rrPeople.forEach((p) => {
      if (!p.sign) return;
      if (!groupsMap.has(p.sign)) {
        groupsMap.set(p.sign, { members: [], count: 0 });
      }
      const g = groupsMap.get(p.sign);
      g.members.push(p);
      g.count += userCounts.get(p.serial_id) || 0;
    });

    const mySign = currentUser?.sign;
    const groups = Array.from(groupsMap.entries())
      .map(([symbol, g]) => {
        const members = g.members
          .map((m) => ({
            id: m.id,
            name: m.full_name || "לא ידוע",
            // A group's active member (their own group's ShiftGroup row is
            // active and its serial_id is theirs) is listed first for the group.
            isActive: isActiveGroupMember(m, shiftGroups),
          }))
          .sort((a, b) => {
            // Active member first, then by name.
            if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
            return a.name.localeCompare(b.name, "he");
          });
        return {
          symbol,
          label: `קבוצה ${symbol}`,
          members,
          hasActive: members.some((m) => m.isActive),
          count: g.count,
          isMine: mySign && symbol === mySign,
        };
      })
      .sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol, "he"));

    const maxCount = Math.max(
      ...users.map((u) => u.count),
      ...groups.map((g) => g.count),
      1,
    );

    return { users, groups, maxCount };
  }, [shifts, people, shiftGroups, coverages, startDate, endDate, currentUser]);

  const setRangeToCurrentMonth = () => {
    setStartDate(format(startOfMonth(today), "yyyy-MM-dd"));
    setEndDate(format(endOfMonth(today), "yyyy-MM-dd"));
  };

  const setRangeToCurrentYear = () => {
    setStartDate(format(startOfYear(today), "yyyy-MM-dd"));
    setEndDate(format(endOfYear(today), "yyyy-MM-dd"));
  };

  const setRangeToYearUntilToday = () => {
    setStartDate(format(startOfYear(today), "yyyy-MM-dd"));
    setEndDate(format(today, "yyyy-MM-dd"));
  };

  if (!isOpen) return null;

  const totalInRange = stats.users.reduce((sum, u) => sum + u.count, 0);

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        dir="rtl"
      >
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
                  בקשות התחשבות בתאריכים ואיזון חלוקת המשמרות
                </p>
              </div>
            </div>
          </div>

          {/* Top-level tabs: fairness matrix vs. consideration */}
          <div className="px-4 md:px-5 pt-3 shrink-0">
            <div className="flex items-center bg-gray-100 rounded-xl p-1">
              <button
                onClick={() => setMode("fairness")}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  mode === "fairness"
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <Scale className="w-4 h-4" />
                טבלת צדק
              </button>
              <button
                onClick={() => setMode("consideration")}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  mode === "consideration"
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <CalendarHeart className="w-4 h-4" />
                התחשבויות
              </button>
            </div>
          </div>

          {/* Controls: date range + tabs (fairness only) */}
          {mode === "fairness" && (
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
              <div className="flex items-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={setRangeToCurrentYear}
                  className="rounded-xl h-9"
                >
                  השנה
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={setRangeToCurrentMonth}
                  className="rounded-xl h-9"
                >
                  החודש
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={setRangeToYearUntilToday}
                  className="rounded-xl h-9"
                >
                  עד עכשיו
                </Button>
              </div>
              <div className="text-xs text-gray-500 mr-auto self-end pb-2">
                סה"כ משמרות בטווח:{" "}
                <span className="font-bold text-gray-800">{totalInRange}</span>
              </div>
            </div>

            <div className="flex items-center bg-gray-100 rounded-xl p-1">
              <button
                onClick={() => setTab("groups")}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === "groups"
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                לפי קבוצה
              </button>
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
            </div>
          </div>
          )}

          {/* Content */}
          <div className="p-4 md:p-6 overflow-y-auto flex-1">
            {mode === "consideration" ? (
              <ConsiderationPanel currentUser={currentUser} isAdmin={isAdmin} />
            ) : isLoading ? (
              <div className="text-center py-10 text-gray-500">
                טוען נתונים...
              </div>
            ) : tab === "users" ? (
              stats.users.length === 0 ? (
                <div className="text-center py-10 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                  <p className="text-gray-500 font-medium">
                    אין משמרות בטווח שנבחר
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {stats.users.map((u) => (
                    <div
                      key={u.id}
                      className={`rounded-xl px-3 py-2 border transition-colors ${
                        u.isMe
                          ? "bg-blue-50 border-blue-300 ring-1 ring-blue-200"
                          : "bg-gray-50 border-gray-100"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="font-semibold text-gray-800 text-sm truncate">
                            {u.name}
                          </span>
                          {u.department && (
                            <span className="text-[11px] text-gray-400 shrink-0">
                              {DEPARTMENT_LABELS[u.department] ||
                                `מחלקה ${u.department}`}
                            </span>
                          )}
                        </div>
                        <span className="text-sm font-bold text-gray-700 shrink-0">
                          {u.count}
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-l from-blue-400 to-indigo-500 rounded-full transition-all"
                          style={{
                            width: `${(u.count / stats.maxCount) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : stats.groups.length === 0 ? (
              <div className="text-center py-10 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                <p className="text-gray-500 font-medium">
                  אין קבוצות עם משמרות בטווח שנבחר
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {stats.groups.map((g) => (
                  <div
                    key={g.symbol}
                    className={`rounded-xl px-3 py-2 border transition-colors ${
                      g.isMine
                        ? "bg-blue-50 border-blue-300 ring-1 ring-blue-200"
                        : "bg-gray-50 border-gray-100"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="font-semibold text-gray-800 text-sm shrink-0">
                          {g.label}
                        </span>
                        {g.members.length > 0 && (
                          <span className="text-[11px] text-gray-400 flex items-center gap-1 min-w-0">
                            {g.hasActive && (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"
                                title="המשתמש הפעיל (ראשון ברשימה)"
                              />
                            )}
                            <span className="truncate">
                              {g.members.map((m) => m.name).join(" · ")}
                            </span>
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-bold text-gray-700 shrink-0">
                        {g.count}
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-l from-blue-400 to-indigo-500 rounded-full transition-all"
                        style={{
                          width: `${(g.count / stats.maxCount) * 100}%`,
                        }}
                      />
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
