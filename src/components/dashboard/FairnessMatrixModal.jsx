import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Scale, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConsiderationPanel from "./ConsiderationPanel";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { resolveOwnerId } from "@/components/calendar/whatsappTemplates";
import DateFieldIL from "@/components/DateFieldIL";
import FairnessUserList from "./FairnessUserList";
import FairnessGroupList from "./FairnessGroupList";
import {
  FAIRNESS_TABS,
  buildFairnessView,
  dayCategory,
  holidayDateSet,
} from "./fairnessCategories";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
} from "date-fns";

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
  // Which slice of the matrix is shown. Everything except חגים is counted per
  // group; a chag's shifts are split between individual people, so its tab is
  // listed per user.
  const [tab, setTab] = useState("all");
  // Top-level tab: the fairness matrix vs. the constraints (אילוצים) tool.
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

  // Chag ranges — a day inside one is counted as a holiday day.
  const { data: holidays = [] } = useQuery({
    queryKey: ["holidays"],
    queryFn: () => base44.entities.Holiday.list(),
    enabled: isOpen,
  });

  const isLoading = isShiftsLoading || isPeopleLoading;

  // One shift count per day type (הכל / חגים / סופ"שים / חמישי / רגילים). A day
  // is a chag day when it falls inside any Holiday range — that wins over the
  // weekday — and each type is laid out both per user and per group.
  const { views, totalInRange } = useMemo(() => {
    const counts = Object.fromEntries(
      FAIRNESS_TABS.map((t) => [t.id, new Map()]),
    );
    // Every authorized person is part of the fairness picture. Who actually
    // takes shifts is governed by the ShiftGroup active-member rule.
    const serialIds = new Set(people.map((p) => p.serial_id));
    const holidayDates = holidayDateSet(holidays);

    // The rota has exactly one shift per calendar day, so a day must be counted
    // once. Guard against duplicate Shift rows for the same date (which would
    // otherwise inflate the total, e.g. 32 in a 31-day month) by keeping only
    // the first shift seen per date within the range.
    const seenDates = new Set();
    let total = 0;
    shifts.forEach((s) => {
      const d = s.start_date;
      if (!d || d < startDate || d > endDate) return;
      if (seenDates.has(d)) return;
      seenDates.add(d);
      // Ownership lives in the base "assignment" ShiftCoverage row (Phase 4).
      const owner = resolveOwnerId(s, coverages);
      // Skip shifts owned by people not in the authorized list.
      if (owner == null || !serialIds.has(owner)) return;
      const bump = (map) => map.set(owner, (map.get(owner) || 0) + 1);
      bump(counts.all);
      bump(counts[dayCategory(d, holidayDates)]);
      total += 1;
    });

    const views = Object.fromEntries(
      FAIRNESS_TABS.map((t) => [
        t.id,
        buildFairnessView({
          counts: counts[t.id],
          people,
          currentUser,
          shiftGroups,
          activeOnly: t.id === "holidays",
        }),
      ]),
    );
    return { views, totalInRange: total };
  }, [
    shifts,
    people,
    holidays,
    coverages,
    shiftGroups,
    startDate,
    endDate,
    currentUser,
  ]);

  const activeView = views[tab] || { users: [], groups: [], maxCount: 1 };

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
                  כמות משמרות לכל משתמש וקבוצה בטווח שנבחר
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
                <Ban className="w-4 h-4" />
                אילוצים
              </button>
            </div>
          </div>

          {/* Controls: date range + tabs (fairness only) */}
          {mode === "fairness" && (
          <div className="p-4 md:p-5 border-b border-gray-100 shrink-0 space-y-3">
            <div className="flex flex-wrap items-end gap-3" dir="rtl">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">תאריך התחלה</label>
                <DateFieldIL
                  value={startDate}
                  onChange={setStartDate}
                  className="w-[140px]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">תאריך סיום</label>
                <DateFieldIL
                  value={endDate}
                  onChange={setEndDate}
                  className="w-[140px]"
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

            <div>
              <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto hide-scrollbar">
                {FAIRNESS_TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex-1 whitespace-nowrap px-2 py-2 rounded-lg text-xs md:text-sm font-medium transition-all ${
                      tab === t.id
                        ? "bg-white text-gray-800 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">
                חגים מוצגים לפי משתמש (שהרי הם מתחלקים בין אנשים); שאר
                הקטגוריות מוצגות לפי קבוצה.
              </p>
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
            ) : tab === "holidays" ? (
              <FairnessUserList
                users={activeView.users}
                maxCount={activeView.maxCount}
                emptyText="אין משמרות בחגים בטווח שנבחר"
              />
            ) : (
              <FairnessGroupList
                groups={activeView.groups}
                maxCount={activeView.maxCount}
                emptyText="אין משמרות בקטגוריה זו בטווח שנבחר"
              />
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