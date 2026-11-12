import React, { useMemo, useState } from "react";
import { format, addDays, subMonths } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarDays,
  Check,
  CheckCircle2,
  History,
  Loader2,
  RefreshCw,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import DateFieldIL from "@/components/DateFieldIL";
import HolidaysSection from "@/components/admin/HolidaysSection";
import DeleteShiftsRangeSection from "@/components/admin/DeleteShiftsRangeSection";
import DistributionPreviewModal from "@/components/admin/DistributionPreviewModal";
import UserComboBox from "@/components/admin/UserComboBox";
import { buildHolidayUserPool } from "@/components/admin/distributionHolidayPool";
import { distributeShifts } from "@/components/calendar/shiftDistributionAlgorithm";
import {
  createAssignmentForShift,
  syncAssignmentOwner,
} from "@/components/calendar/whatsappTemplates";
import { base44, logActivity } from "@/api/base44Client";
import {
  holidayDefinitions,
  resolveDistributionHolidays,
  yearsOfRange,
} from "@/lib/holidayRanges";
import { deleteShiftsInRange } from "@/lib/shiftDeletion";
import { runThrottled } from "@/lib/runThrottled";
import { activeMemberSerialIdOnDate } from "@/lib/utils";
import { toast } from "sonner";

/**
 * The "חלוקת משמרות" tab: run the fair distribution, review the result in the
 * preview window (year calendar + fairness stats) and only then write it, plus
 * the range-delete and range-replace tools that live on the same screen.
 */
export default function DistributionTab({
  shifts = [],
  holidays = [],
  people = [],
  activeGroupBySymbol = new Map(),
  membersBySymbol = new Map(),
  switchGraceDays = "30",
  onGraceChange,
  onSaveGrace,
  isSavingGrace = false,
}) {
  const queryClient = useQueryClient();

  const [range, setRange] = useState({ startDate: "", endDate: "" });
  const [historyMonths, setHistoryMonths] = useState("6");
  // Run options. Constraints (אילוצים) are honored by default; overwriting
  // existing shifts is off by default, so a run only fills free days.
  const [respectConstraints, setRespectConstraints] = useState(true);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  // The parameters of the last run, so a constraint deleted in the preview can
  // re-run the same distribution.
  const [lastRunParams, setLastRunParams] = useState(null);
  // The last COMMITTED run (its summary stays on screen), and the run that is
  // only being previewed — nothing is written for the latter.
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  const [deleteRange, setDeleteRange] = useState({ startDate: "", endDate: "" });
  const [deleteError, setDeleteError] = useState("");
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const [replaceForm, setReplaceForm] = useState({
    startDate: "",
    endDate: "",
    fromUserId: "",
    toUserId: "",
  });
  const [replaceError, setReplaceError] = useState("");
  const [isReplaceConfirmOpen, setIsReplaceConfirmOpen] = useState(false);

  // 1. Compute the distribution WITHOUT writing anything. Each group
  // contributes ONE fairness participant — its "representative", the member
  // active at the START of the range (activeMemberSerialIdOnDate, which honors
  // a scheduled switch). The group is treated as a single unit for fairness
  // across a switch: the algorithm runs on the representative, then ownership
  // is remapped per date so shifts on/after the switch date go to the incoming
  // member. This keeps the group's total shift count the same whether or not it
  // switches mid-range.
  const runMutation = useMutation({
    mutationFn: async ({
      startDate,
      endDate,
      respectConstraints: useConstraints = true,
      overwriteExisting: overwrite = false,
    }) => {
      const grace = Math.max(0, Math.floor(Number(switchGraceDays)) || 0);
      const peopleBySerial = new Map(
        people.map((p) => [Number(p.serial_id), p]),
      );

      // Constraints (אילוצים): a person is never assigned a shift on a date they
      // set a constraint for. Constraints take effect immediately with no
      // approval, so every non-rejected request counts (the legacy "rejected"
      // status is still excluded for backward compatibility). Fetched fresh so a
      // just-added constraint is respected without relying on cache warmth.
      const activeRequests = (
        await base44.entities.ConsiderationRequest.list()
      ).filter((r) => r.status !== "rejected" && r.serial_id != null && r.date);
      // With "התחשבות באילוצים" off the run ignores them entirely (they are
      // kept in the system, they just don't block dates in this run).
      const rawProtected = new Map(); // serial_id -> Set(dates)
      (useConstraints ? activeRequests : []).forEach((r) => {
        const key = Number(r.serial_id);
        if (!rawProtected.has(key)) rawProtected.set(key, new Set());
        rawProtected.get(key).add(r.date);
      });

      const reps = []; // fairness participants (one per group)
      const protectedDates = new Map(); // repSerial -> Set(dates)
      const repInfo = new Map(); // repSerial -> { switchDate, incomingSerial }
      const ownerRemap = new Map(); // any member serial -> repSerial (for seeding)
      const symbolToRep = new Map(); // group symbol -> repSerial (for history-by-group)

      const addProtected = (repSerial, dates) => {
        if (!dates) return;
        if (!protectedDates.has(repSerial))
          protectedDates.set(repSerial, new Set());
        const set = protectedDates.get(repSerial);
        dates.forEach((d) => set.add(d));
      };

      activeGroupBySymbol.forEach((group, symbol) => {
        const repSerial = activeMemberSerialIdOnDate(group, startDate);
        if (repSerial == null) return; // no active member at range start
        const rep = peopleBySerial.get(Number(repSerial));
        // Only RR/Manager members are in the rotation, and the representative
        // must actually belong to this group (guards a stale scheduled serial).
        if (
          !rep ||
          !["RR", "Manager"].includes(rep.permissions) ||
          rep.sign !== symbol
        )
          return;

        reps.push(rep);
        const repKey = Number(repSerial);
        symbolToRep.set(symbol, repKey);

        // A scheduled deactivate: from that date on the group has no active
        // member, so its slot must receive no shifts on/after it.
        const isDeactivate =
          !!group.scheduled_switch_date && !!group.scheduled_switch_deactivate;
        const deactivateDate = isDeactivate ? group.scheduled_switch_date : null;
        const hasSwitch =
          !!group.scheduled_switch_date &&
          !isDeactivate &&
          group.scheduled_switch_serial_id != null;
        const switchDate = hasSwitch ? group.scheduled_switch_date : null;
        const incomingSerial = hasSwitch
          ? Number(group.scheduled_switch_serial_id)
          : null;
        const outgoingSerial =
          group.active && group.serial_id != null
            ? Number(group.serial_id)
            : null;

        repInfo.set(repKey, { switchDate, incomingSerial });

        // Fold both switch members into the representative so the group's prior
        // in-range shifts (owned by whoever) count as ONE unit for fairness.
        ownerRemap.set(repKey, repKey);
        if (outgoingSerial != null) ownerRemap.set(outgoingSerial, repKey);
        if (incomingSerial != null) ownerRemap.set(incomingSerial, repKey);

        if (hasSwitch && incomingSerial != null) {
          // Constraints, split across the switch date: before it the outgoing
          // member's constraints apply to the group's slot, on/after it the
          // incoming member's.
          if (outgoingSerial != null) {
            const before = [...(rawProtected.get(outgoingSerial) || [])].filter(
              (d) => d < switchDate,
            );
            addProtected(repKey, before);
          }
          const after = [...(rawProtected.get(incomingSerial) || [])].filter(
            (d) => d >= switchDate,
          );
          addProtected(repKey, after);

          // Grace period: leave the incoming member free of shifts for `grace`
          // days from the switch date (the group's slot is protected there).
          if (grace > 0) {
            const graceSet = new Set();
            const base = new Date(switchDate);
            for (let i = 0; i < grace; i++) {
              graceSet.add(format(addDays(base, i), "yyyy-MM-dd"));
            }
            addProtected(repKey, graceSet);
          }
        } else if (isDeactivate) {
          // Scheduled deactivate: the representative (active at range start)
          // holds the group's slot only BEFORE the deactivate date — its own
          // constraints apply there. Every date on/after it is protected on the
          // rep so the algorithm never assigns the (now memberless) group a
          // shift; those days flow to the other active groups instead.
          const before = [...(rawProtected.get(repKey) || [])].filter(
            (d) => d < deactivateDate,
          );
          addProtected(repKey, before);

          const goneSet = new Set();
          let cursor = new Date(
            deactivateDate > startDate ? deactivateDate : startDate,
          );
          const rangeEnd = new Date(endDate);
          while (cursor <= rangeEnd) {
            goneSet.add(format(cursor, "yyyy-MM-dd"));
            cursor = addDays(cursor, 1);
          }
          addProtected(repKey, goneSet);
        } else {
          // No scheduled switch — the representative's own constraints.
          addProtected(repKey, rawProtected.get(repKey));
        }
      });

      if (reps.length === 0) {
        throw new Error(
          "אין עובדים זכאים לחלוקה — נדרש משתמש פעיל בקבוצה (RR או Manager, פעיל בקבוצה). הגדירו משתמשים פעילים בלשונית 'ניהול קבוצות'.",
        );
      }

      // Shifts already in the calendar inside the range. Normally they are kept
      // as they are and the run only fills the free days around them. With
      // "דריסת משמרות קיימות" they are hidden from the run — the algorithm sees
      // a completely free range — and are replaced when the preview is approved.
      const inRangeShifts = (shifts || []).filter(
        (s) => s.start_date >= startDate && s.start_date <= endDate,
      );
      const seedShifts = overwrite
        ? (shifts || []).filter(
            (s) => !(s.start_date >= startDate && s.start_date <= endDate),
          )
        : shifts || [];

      // Seed the algorithm with existing shifts, but with each group's members
      // folded onto its representative so a group that already switched (or has
      // shifts under both members) is counted as one unit.
      const remappedShifts = seedShifts.map((s) => {
        const owner = Number(s.original_user_id);
        const mapped = ownerRemap.get(owner);
        return mapped != null && mapped !== owner
          ? { ...s, original_user_id: mapped }
          : s;
      });

      // Historical fairness baseline: count each group's shifts in the chosen
      // number of months BEFORE the range start (0 = off) and seed the fairness
      // table with them, so a group that worked a lot recently is deprioritized.
      // Counted BY GROUP — every shift is attributed to its owner's group
      // representative, regardless of which member actually worked it.
      const historyWindow = Math.max(0, Math.floor(Number(historyMonths)) || 0);
      const priorJustice = new Map();
      if (historyWindow > 0) {
        const historyStart = format(
          subMonths(new Date(startDate), historyWindow),
          "yyyy-MM-dd",
        );
        shifts.forEach((s) => {
          if (!s.start_date) return;
          if (s.start_date >= startDate || s.start_date < historyStart) return;
          const owner = peopleBySerial.get(Number(s.original_user_id));
          const repKey = owner?.sign ? symbolToRep.get(owner.sign) : null;
          if (repKey == null) return; // owner's group isn't in the active pool
          priorJustice.set(repKey, (priorJustice.get(repKey) || 0) + 1);
        });
      }

      // Holidays are divided between PEOPLE: alongside the group
      // representatives, the algorithm gets a per-user holiday pool.
      const holidayUsers = buildHolidayUserPool({
        groups: activeGroupBySymbol,
        members: membersBySymbol,
        rawProtected,
        shifts: seedShifts,
        startDate,
        endDate,
        grace,
      });

      // Chag dates for this range, plus the Chol HaMoed days no row covers.
      const { holidays: resolvedHolidays, cholHamoedDates } =
        await resolveDistributionHolidays(
          holidayDefinitions(holidays),
          yearsOfRange(startDate, endDate),
        );
      const distribution = distributeShifts({
        people: reps,
        existingShifts: remappedShifts,
        startDate,
        endDate,
        holidays: resolvedHolidays,
        cholHamoedDates,
        holidayUsers,
        protectedDates,
        priorJustice,
      });

      // Remap each assignment from the representative to the member who is
      // actually active on that date — i.e. hand shifts on/after the switch
      // date to the incoming member.
      const finalAssignments = distribution.assignments.map((a) => {
        const info = repInfo.get(Number(a.personId));
        if (
          info?.switchDate &&
          info.incomingSerial != null &&
          a.date >= info.switchDate
        ) {
          return { date: a.date, personId: info.incomingSerial };
        }
        return a;
      });

      // Chag dates, for the calendar's markers in the preview window.
      const holidayKeys = [];
      resolvedHolidays.forEach((holiday) => {
        const first = new Date(`${holiday.start_date}T00:00:00`);
        const last = new Date(
          `${holiday.end_date || holiday.start_date}T00:00:00`,
        );
        for (const day = first; day <= last; day.setDate(day.getDate() + 1)) {
          holidayKeys.push(format(day, "yyyy-MM-dd"));
        }
      });
      cholHamoedDates.forEach((key) => holidayKeys.push(String(key).slice(0, 10)));

      // Shifts already in the calendar inside the range. The distribution only
      // fills free days, so these are not reassigned — but the preview calendar
      // shows them (grey) so an already-scheduled range doesn't look empty.
      // When the range is being overwritten they are not shown as existing:
      // the run above already scheduled those days, and approving replaces them.
      const existingInRange = overwrite
        ? []
        : inRangeShifts
            .filter((s) => s.original_user_id != null)
            .map((s) => ({
              date: String(s.start_date).slice(0, 10),
              personId: Number(s.original_user_id),
            }));

      // The constraints that shaped this run, as a list the admin can review in
      // the preview (and delete, which re-runs the distribution).
      const activeSerials = new Set();
      activeGroupBySymbol.forEach((_group, symbol) => {
        (membersBySymbol.get(symbol) || []).forEach((member) => {
          if (member?.serial_id != null)
            activeSerials.add(Number(member.serial_id));
        });
      });
      const constraintsInRange = useConstraints
        ? activeRequests
            .filter((r) => {
              const key = String(r.date).slice(0, 10);
              return (
                key >= startDate &&
                key <= endDate &&
                activeSerials.has(Number(r.serial_id))
              );
            })
            .map((r) => ({
              id: r.id,
              serial_id: Number(r.serial_id),
              user_name:
                r.user_name ||
                peopleBySerial.get(Number(r.serial_id))?.full_name ||
                `#${r.serial_id}`,
              date: String(r.date).slice(0, 10),
              note: r.note || "",
            }))
            .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        : [];

      // NOTHING is written here: this is the preview. The shifts are created
      // only when the result is approved in the preview window.
      return {
        ...distribution,
        assignments: finalAssignments,
        existing: existingInRange,
        overwrite,
        replaceShiftIds: overwrite ? inRangeShifts.map((s) => s.id) : [],
        constraints: constraintsInRange,
        startDate,
        endDate,
        holidayKeys,
        poolSize: reps.length,
      };
    },
    onSuccess: (computed) => {
      setPreview(computed);
      setError("");
    },
    onError: (e) => {
      setError(e?.message || "חלוקת המשמרות נכשלה. נסו שוב.");
      setPreview(null);
    },
  });

  // 2. Commit an approved preview: create each shift slot (a pure time slot;
  // Phase 4), then its base "assignment" coverage row recording the owner.
  // Throttled so a large distribution can't trip the rate limiter — creating N
  // shifts + N coverage rows in one burst does.
  const commitMutation = useMutation({
    mutationFn: async (approved) => {
      // Overwrite: the shifts that already sat in the range are removed first
      // (with their coverages and swap requests), then the new distribution is
      // written in their place.
      if (approved.overwrite && approved.replaceShiftIds?.length) {
        await deleteShiftsInRange(approved.replaceShiftIds);
      }
      await runThrottled(
        approved.assignments.map((a) => async () => {
          const shift = await base44.entities.Shift.create({
            start_date: a.date,
            end_date: a.date,
            start_time: "09:00",
            end_time: "09:00",
          });
          await createAssignmentForShift(shift, a.personId);
        }),
      );
      return approved;
    },
    onSuccess: (approved) => {
      logActivity({
        action: `חלוקת ${approved.assignments.length} משמרות (${approved.startDate} — ${approved.endDate})`,
        type: "הוספת משמרות",
        entity: "Shift",
        details: {
          count: approved.assignments.length,
          overwritten: approved.replaceShiftIds?.length || 0,
          start_date: approved.startDate,
          end_date: approved.endDate,
          shifts: approved.assignments.map((a) => ({
            date: a.date,
            owner: people.find(
              (p) => Number(p.serial_id) === Number(a.personId),
            )?.full_name,
          })),
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["coverages"]);
      setResult(approved);
      setPreview(null);
      setError("");
      toast.success(`שובצו ${approved.assignments.length} משמרות`);
    },
    onError: (e) => {
      setError(e?.message || "שיבוץ המשמרות נכשל. נסו שוב.");
    },
  });

  // 5. Delete a constraint straight from the preview and recompute the same
  // distribution, so the freed date is staffed without leaving the window.
  const deleteConstraintMutation = useMutation({
    mutationFn: async (constraint) => {
      await base44.entities.ConsiderationRequest.delete(constraint.id);
      return constraint;
    },
    onSuccess: (constraint) => {
      logActivity({
        action: `מחיקת אילוץ של ${constraint.user_name} (${constraint.date}) מתוך תצוגת החלוקה`,
        type: "בקשת התחשבות",
        entity: "ConsiderationRequest",
        details: {
          requester: constraint.user_name,
          date: constraint.date,
        },
      });
      queryClient.invalidateQueries({ queryKey: ["consideration-requests"] });
      toast.success("האילוץ נמחק — מחשב חלוקה מחדש");
      if (lastRunParams) runMutation.mutate(lastRunParams);
    },
    onError: (e) => {
      toast.error(e?.message || "מחיקת האילוץ נכשלה. נסו שוב.");
    },
  });

  const handleRun = () => {
    const { startDate, endDate } = range;
    if (!startDate || !endDate) {
      setError("נא לבחור תאריך התחלה וסיום");
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      setError("תאריך הסיום חייב להיות אחרי תאריך ההתחלה");
      return;
    }
    setError("");
    setResult(null);
    const params = { startDate, endDate, respectConstraints, overwriteExisting };
    setLastRunParams(params);
    runMutation.mutate(params);
  };

  // 3. Delete all shifts within a chosen date range (e.g. to undo a bad
  // distribution run or clear out a period before re-running it).
  const shiftsInDeleteRange = useMemo(() => {
    const { startDate, endDate } = deleteRange;
    if (!startDate || !endDate) return [];
    return shifts.filter(
      (s) => s.start_date >= startDate && s.start_date <= endDate,
    );
  }, [shifts, deleteRange]);

  const deleteRangeMutation = useMutation({
    mutationFn: (shiftIds) => deleteShiftsInRange(shiftIds),
    onSuccess: (count) => {
      logActivity({
        action: `מחיקת ${count} משמרות בטווח תאריכים`,
        type: "מחיקת משמרות",
        entity: "Shift",
        details: {
          count,
          start_date: deleteRange.startDate,
          end_date: deleteRange.endDate,
          shifts: shiftsInDeleteRange.map((s) => ({
            date: s.start_date,
            start_time: s.start_time,
            end_time: s.end_time,
            owner: people.find(
              (p) => Number(p.serial_id) === Number(s.original_user_id),
            )?.full_name,
          })),
        },
      });
      ["shifts", "coverages", "swap-requests"].forEach((key) =>
        queryClient.invalidateQueries([key]),
      );
      toast.success(`נמחקו ${count} משמרות בהצלחה`);
      setIsDeleteConfirmOpen(false);
      setDeleteRange({ startDate: "", endDate: "" });
    },
    onError: (e) => {
      toast.error(e?.message || "מחיקת המשמרות נכשלה. נסו שוב.");
    },
  });

  const requestDelete = () => {
    const { startDate, endDate } = deleteRange;
    if (!startDate || !endDate) {
      setDeleteError("נא לבחור תאריך התחלה וסיום");
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      setDeleteError("תאריך הסיום חייב להיות אחרי תאריך ההתחלה");
      return;
    }
    setDeleteError("");
    setIsDeleteConfirmOpen(true);
  };

  // 4. Replace one user's shifts with another's, within a date range — every
  // shift assigned to `fromUserId` whose start_date falls inside [startDate,
  // endDate] is reassigned to `toUserId` (leaves everyone else's shifts alone).
  const shiftsInReplaceRange = useMemo(() => {
    const { startDate, endDate, fromUserId } = replaceForm;
    if (!startDate || !endDate || !fromUserId) return [];
    return shifts.filter(
      (s) =>
        Number(s.original_user_id) === Number(fromUserId) &&
        s.start_date >= startDate &&
        s.start_date <= endDate,
    );
  }, [shifts, replaceForm]);

  const replaceMutation = useMutation({
    mutationFn: async ({ shiftIds, toUserId }) => {
      // Ownership = the base "assignment" coverage row (Phase 4). Repoint it per
      // shift, throttled to stay under the rate limit on big ranges.
      const coverages = await base44.entities.ShiftCoverage.list();
      await runThrottled(
        shiftIds.map(
          (id) => () => syncAssignmentOwner(id, Number(toUserId), coverages),
        ),
      );
      return shiftIds.length;
    },
    onSuccess: (count) => {
      logActivity({
        action: `החלפת ${count} משמרות בין משתמשים`,
        type: "שינויים בהרשאות",
        entity: "ShiftCoverage",
        details: {
          count,
          from: people.find(
            (p) => Number(p.serial_id) === Number(replaceForm.fromUserId),
          )?.full_name,
          to: people.find(
            (p) => Number(p.serial_id) === Number(replaceForm.toUserId),
          )?.full_name,
          start_date: replaceForm.startDate,
          end_date: replaceForm.endDate,
          shifts: shiftsInReplaceRange.map((s) => ({
            date: s.start_date,
            start_time: s.start_time,
            end_time: s.end_time,
          })),
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["coverages"]);
      toast.success(`הוחלפו ${count} משמרות בהצלחה`);
      setIsReplaceConfirmOpen(false);
      setReplaceForm({
        startDate: "",
        endDate: "",
        fromUserId: "",
        toUserId: "",
      });
    },
    onError: (e) => {
      toast.error(e?.message || "החלפת המשמרות נכשלה. נסו שוב.");
    },
  });

  const requestReplace = () => {
    const { startDate, endDate, fromUserId, toUserId } = replaceForm;
    if (!fromUserId || !toUserId) {
      setReplaceError("נא לבחור משתמש מוחלף ומשתמש מחליף");
      return;
    }
    if (Number(fromUserId) === Number(toUserId)) {
      setReplaceError("יש לבחור שני משתמשים שונים");
      return;
    }
    if (!startDate || !endDate) {
      setReplaceError("נא לבחור תאריך התחלה וסיום");
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      setReplaceError("תאריך הסיום חייב להיות אחרי תאריך ההתחלה");
      return;
    }
    if (shiftsInReplaceRange.length === 0) {
      setReplaceError("לא נמצאו משמרות למשתמש המוחלף בטווח שנבחר");
      return;
    }
    setReplaceError("");
    setIsReplaceConfirmOpen(true);
  };

  return (
    <div className="space-y-4 md:space-y-6 overflow-y-auto">
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-gray-800">
              חלוקה הוגנת של משמרות
            </p>
            <p className="text-xs text-gray-500 max-w-xl">
              מפזר משמרות רק על ימים פנויים בטווח שנבחר, בלי לגעת במשמרות
              קיימות: משמרת אחת מוקצית לכל אדם בשבוע (א'-ש'); יוצא דופן הוא צירוף
              שישי-שבת, שמוקצה תמיד יחד לאותו אדם. החגים נקבעים לפי הקבוצות
              שברשימת החגים שלהלן: כל קבוצה (שנוצרת מגרירת חגים אחד על השני)
              נחשבת לגוש אחד עם מספר ה"חלוקות" שלה (1 = כל הקבוצה נשארת אצל אותו
              אדם), והתאריכים נגזרים מהלוח העברי בכל שנה מחדש. חלקי הקבוצה
              מחולקים בין המשתמשים לפי מספר המשמרות שכל אחד צבר בטווח. הפיזור
              נשמר נוח ולא יום אחרי יום בטעות, והבחירה מתבססת על טבלת "צדק" —
              איזון לפי סוג היום וניקוד מאמץ, כדי שמי שקיבל חגים וסופ"שים יקבל
              פחות ימים רגילים. <b>ההרצה נפתחת בחלון תצוגה מקדימה</b> עם לוח
              השנה והנתונים — המשמרות נכתבות רק בלחיצה על אישור בו.
            </p>
          </div>
          <Scale className="w-5 h-5 text-blue-500 shrink-0" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" dir="rtl">
          <div className="grid gap-1">
            <Label className="text-sm text-gray-700">תאריך התחלה</Label>
            <DateFieldIL
              value={range.startDate}
              onChange={(iso) => setRange((prev) => ({ ...prev, startDate: iso }))}
              className="rounded-xl"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-sm text-gray-700">תאריך סיום</Label>
            <DateFieldIL
              value={range.endDate}
              onChange={(iso) => setRange((prev) => ({ ...prev, endDate: iso }))}
              className="rounded-xl"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
          <div className="flex items-start gap-2">
            <History className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-800">
                התחשבות בחודשים האחרונים
              </p>
              <p className="text-xs text-gray-500 max-w-md">
                החלוקה מתחשבת במספר המשמרות שכל קבוצה צברה במספר החודשים שתבחרו
                לפני תאריך ההתחלה (לפי קבוצות, לא לפי משתמשים), כדי לאזן את העומס
                לאורך זמן. 0 = ללא התחשבות בהיסטוריה — הצדק מחושב רק בטווח
                שנבחר. ברירת המחדל: 6.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Input
              type="number"
              min="0"
              step="1"
              value={historyMonths}
              onChange={(e) => setHistoryMonths(e.target.value)}
              className="rounded-xl w-24 h-9"
              aria-label="מספר חודשי ההיסטוריה"
            />
            <span className="text-xs text-gray-500">חודשים</span>
          </div>
        </div>

        <div
          className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3"
          dir="rtl"
        >
          <div className="flex items-start gap-2">
            <RefreshCw className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-800">
                דריסת משמרות קיימות בטווח
              </p>
              <p className="text-xs text-gray-500 max-w-md">
                כבוי: החלוקה משבצת רק ימים פנויים ומשאירה כל משמרת קיימת במקומה.
                מופעל: החלוקה מתייחסת לכל הטווח כריק ומשבצת מחדש את כל הימים,
                ובעת האישור בתצוגה המקדימה המשמרות הקיימות בטווח נמחקות ומוחלפות
                בשיבוץ החדש.
              </p>
            </div>
          </div>
          <Switch
            checked={overwriteExisting}
            onCheckedChange={setOverwriteExisting}
            disabled={runMutation.isPending}
            aria-label="דריסת משמרות קיימות בטווח"
            className="shrink-0"
          />
        </div>

        <div
          className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3"
          dir="rtl"
        >
          <div className="flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-800">
                התחשבות באילוצים
              </p>
              <p className="text-xs text-gray-500 max-w-md">
                מופעל (ברירת מחדל): אדם לא ישובץ ביום שהגדיר לו אילוץ. רשימת
                האילוצים שנשקלו מופיעה בתצוגה המקדימה, ומשם אפשר למחוק אילוץ
                ולחשב את החלוקה מחדש. כבוי: החלוקה מתעלמת מהאילוצים (הם נשארים
                במערכת).
              </p>
            </div>
          </div>
          <Switch
            checked={respectConstraints}
            onCheckedChange={setRespectConstraints}
            disabled={runMutation.isPending}
            aria-label="התחשבות באילוצים"
            className="shrink-0"
          />
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">
            {error}
          </p>
        )}

        <Button
          onClick={handleRun}
          disabled={runMutation.isPending}
          className="w-full md:w-auto mt-4 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          {runMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> מחשב חלוקה...
            </>
          ) : (
            <>
              <Scale className="w-4 h-4" /> חשב חלוקה לתצוגה מקדימה
            </>
          )}
        </Button>
      </div>

      <HolidaysSection />

      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-gray-800">
              תקופת חסד להחלפה מתוזמנת
            </p>
            <p className="text-xs text-gray-500 max-w-xl">
              כאשר מתוזמנת החלפת משתמש פעיל בקבוצה (בלשונית "ניהול קבוצות"),
              המשתמש הנכנס יישאר פנוי ממשמרות למשך מספר הימים שנבחר מתאריך
              ההחלפה. 0 = ללא תקופת חסד. ברירת המחדל: 30 ימים.
            </p>
          </div>
          <CalendarDays className="w-5 h-5 text-blue-500 shrink-0" />
        </div>
        <div className="flex items-end gap-3" dir="rtl">
          <div className="grid gap-1">
            <Label className="text-sm text-gray-700">ימי כבוד למשתמש הנכנס</Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={switchGraceDays}
              onChange={(e) => onGraceChange?.(e.target.value)}
              className="rounded-xl w-32"
            />
          </div>
          <Button
            onClick={() => onSaveGrace?.()}
            disabled={isSavingGrace}
            className="h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            {isSavingGrace ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> שומר...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" /> שמור
              </>
            )}
          </Button>
        </div>
      </div>

      <DeleteShiftsRangeSection
        range={deleteRange}
        onChange={(patch) => setDeleteRange((prev) => ({ ...prev, ...patch }))}
        error={deleteError}
        onRequest={requestDelete}
      />

      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-gray-800">
              החלפת משמרות בין משתמשים
            </p>
            <p className="text-xs text-gray-500 max-w-xl">
              מעביר את כל המשמרות של המשתמש המוחלף אל המשתמש המחליף, בטווח
              התאריכים שנבחר (כולל שני התאריכים). משמרות של משתמשים אחרים לא
              מושפעות.
            </p>
          </div>
          <ArrowLeftRight className="w-5 h-5 text-blue-500 shrink-0" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" dir="rtl">
          <div className="grid gap-1">
            <Label className="text-sm text-gray-700">
              משתמש מוחלף (מעביר את משמרותיו)
            </Label>
            <UserComboBox
              users={people}
              value={replaceForm.fromUserId}
              excludeId={replaceForm.toUserId}
              placeholder="בחר משתמש מוחלף"
              onChange={(id) =>
                setReplaceForm((prev) => ({ ...prev, fromUserId: id }))
              }
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-sm text-gray-700">
              משתמש מחליף (מקבל את המשמרות)
            </Label>
            <UserComboBox
              users={people}
              value={replaceForm.toUserId}
              excludeId={replaceForm.fromUserId}
              placeholder="בחר משתמש מחליף"
              onChange={(id) =>
                setReplaceForm((prev) => ({ ...prev, toUserId: id }))
              }
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-sm text-gray-700">תאריך התחלה</Label>
            <DateFieldIL
              value={replaceForm.startDate}
              onChange={(iso) =>
                setReplaceForm((prev) => ({ ...prev, startDate: iso }))
              }
              className="rounded-xl"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-sm text-gray-700">תאריך סיום</Label>
            <DateFieldIL
              value={replaceForm.endDate}
              onChange={(iso) =>
                setReplaceForm((prev) => ({ ...prev, endDate: iso }))
              }
              className="rounded-xl"
            />
          </div>
        </div>

        {replaceError && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">
            {replaceError}
          </p>
        )}

        <Button
          onClick={requestReplace}
          disabled={replaceMutation.isPending}
          className="w-full md:w-auto mt-4 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          <ArrowLeftRight className="w-4 h-4" /> החלף משמרות
        </Button>
      </div>

      {result && (
        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="w-5 h-5" />
            <p className="text-sm font-semibold">
              נוצרו {result.assignments.length} משמרות חדשות
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">
              טבלת הצדק (סה"כ משמרות לכל הזמנים, אחרי הריצה)
            </p>
            <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
              {result.justiceTable.map((row) => (
                <div
                  key={row.personId}
                  className="flex items-center justify-between text-sm bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5"
                >
                  <span className="text-gray-700 font-medium">{row.name}</span>
                  <span className="text-gray-500 font-mono text-xs">
                    {row.totalShifts} משמרות
                  </span>
                </div>
              ))}
            </div>
          </div>

          {result.skipped.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
              <p className="text-xs font-semibold text-yellow-800 mb-1">
                ימים שלא שובצו (לא אותר אדם זמין עם מכסה שבועית פנויה)
              </p>
              <div className="text-xs text-yellow-800 space-y-0.5">
                {result.skipped.map((s, idx) => (
                  <p key={`${s.date}-${idx}`} dir="ltr">
                    {format(new Date(s.date), "dd/MM/yyyy")}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <DistributionPreviewModal
        open={!!preview}
        preview={preview}
        people={people}
        isSaving={commitMutation.isPending}
        isRunning={runMutation.isPending}
        deletingConstraintId={
          deleteConstraintMutation.isPending
            ? deleteConstraintMutation.variables?.id
            : null
        }
        onDeleteConstraint={(constraint) =>
          deleteConstraintMutation.mutate(constraint)
        }
        onApprove={() => preview && commitMutation.mutate(preview)}
        onClose={() => setPreview(null)}
      />

      {/* Delete-shifts-in-range confirmation */}
      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[400px] text-right" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-xl text-red-600">
              <div className="bg-red-100 p-2 rounded-full">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              מחיקת משמרות
            </DialogTitle>
          </DialogHeader>

          <div className="py-4">
            <p className="text-gray-600">
              האם הנך בטוח שברצונך למחוק{" "}
              <b>{shiftsInDeleteRange.length} משמרות</b> בטווח{" "}
              <span dir="ltr">
                {deleteRange.startDate &&
                  format(new Date(deleteRange.startDate), "dd/MM/yyyy")}{" "}
                -{" "}
                {deleteRange.endDate &&
                  format(new Date(deleteRange.endDate), "dd/MM/yyyy")}
              </span>
              ?
              <br />
              פעולה זו אינה הפיכה.
            </p>
          </div>

          <DialogFooter className="flex gap-2 w-full">
            <Button
              onClick={() =>
                deleteRangeMutation.mutate(shiftsInDeleteRange.map((s) => s.id))
              }
              disabled={deleteRangeMutation.isPending}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white"
            >
              {deleteRangeMutation.isPending ? "מוחק..." : "כן, מחיקה"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setIsDeleteConfirmOpen(false)}
              disabled={deleteRangeMutation.isPending}
              className="flex-1"
            >
              לא, ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Replace-shifts-between-users confirmation */}
      <Dialog open={isReplaceConfirmOpen} onOpenChange={setIsReplaceConfirmOpen}>
        <DialogContent className="sm:max-w-[420px] text-right" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-xl text-blue-600">
              <div className="bg-blue-100 p-2 rounded-full">
                <ArrowLeftRight className="w-5 h-5 text-blue-600" />
              </div>
              החלפת משמרות בין משתמשים
            </DialogTitle>
          </DialogHeader>

          <div className="py-4">
            <p className="text-gray-600">
              להעביר <b>{shiftsInReplaceRange.length} משמרות</b> מ־
              <b>
                {
                  people.find(
                    (p) =>
                      Number(p.serial_id) === Number(replaceForm.fromUserId),
                  )?.full_name
                }
              </b>{" "}
              אל{" "}
              <b>
                {
                  people.find(
                    (p) => Number(p.serial_id) === Number(replaceForm.toUserId),
                  )?.full_name
                }
              </b>{" "}
              בטווח{" "}
              <span dir="ltr">
                {replaceForm.startDate &&
                  format(new Date(replaceForm.startDate), "dd/MM/yyyy")}{" "}
                -{" "}
                {replaceForm.endDate &&
                  format(new Date(replaceForm.endDate), "dd/MM/yyyy")}
              </span>
              ?
            </p>
          </div>

          <DialogFooter className="flex gap-2 w-full">
            <Button
              onClick={() =>
                replaceMutation.mutate({
                  shiftIds: shiftsInReplaceRange.map((s) => s.id),
                  toUserId: replaceForm.toUserId,
                })
              }
              disabled={replaceMutation.isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {replaceMutation.isPending ? "מחליף..." : "כן, החלף"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setIsReplaceConfirmOpen(false)}
              disabled={replaceMutation.isPending}
              className="flex-1"
            >
              לא, ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}