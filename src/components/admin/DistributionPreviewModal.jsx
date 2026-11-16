import React, { useEffect, useMemo, useState } from "react";
import { Check, Loader2, CalendarRange, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { buildPreviewModel, MARK_COLORS, violationsFor } from "./previewModel";
import DistributionPreviewCalendar from "./DistributionPreviewCalendar";
import DistributionPreviewPeopleBar from "./DistributionPreviewPeopleBar";
import DistributionPreviewSummary from "./DistributionPreviewSummary";
import DistributionPreviewTable from "./DistributionPreviewTable";
import DistributionPreviewConstraints from "./DistributionPreviewConstraints";
import DistributionPreviewCsvBar from "./DistributionPreviewCsvBar";
import {
  buildAssignmentsCsv,
  csvFileName,
  downloadCsv,
  keyOf,
  parseAssignmentsCsv,
  readCsvFile,
} from "./previewCsv";

const NO_ASSIGNMENTS = [];

// How many days the imported file assigns differently from the run that was
// computed — the "what did I actually change" figure shown next to the file name.
const countChanges = (base, next) => {
  const before = new Map(
    (base || []).map((entry) => [keyOf(entry.date), Number(entry.personId)]),
  );
  const after = new Map(
    (next || []).map((entry) => [keyOf(entry.date), Number(entry.personId)]),
  );
  const dates = new Set([...before.keys(), ...after.keys()]);
  let changed = 0;
  dates.forEach((date) => {
    if (before.get(date) !== after.get(date)) changed += 1;
  });
  return changed;
};

const formatIL = (iso) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").slice(0, 10));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(iso || "");
};

// "14:32" — the moment the run on screen was computed.
const formatTime = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

/**
 * The result of a distribution run, shown before anything is written: the whole
 * range as a per-month calendar (one pastel per person) plus the fairness
 * figures. Approving it commits the shifts; cancelling throws the run away and
 * leaves the calendar untouched.
 */
export default function DistributionPreviewModal({
  open,
  preview,
  people,
  isSaving,
  isRunning,
  deletingConstraintId,
  onDeleteConstraint,
  onRestoreConstraint,
  ignoredConstraints = [],
  ignoredCount = 0,
  onRestoreIgnored,
  onRerun,
  onApprove,
  onClose,
  error,
}) {
  const [highlight, setHighlight] = useState(null);
  // A schedule read back from a CSV file. It replaces the run on screen (and is
  // what approval would write) until it is cleared or a new run arrives.
  const [imported, setImported] = useState(null);
  const [importErrors, setImportErrors] = useState([]);

  useEffect(() => {
    setImported(null);
    setImportErrors([]);
  }, [preview?.computedAt]);

  const assignments = imported?.assignments ?? preview?.assignments ?? NO_ASSIGNMENTS;

  const model = useMemo(
    () =>
      preview
        ? buildPreviewModel({ ...preview, assignments, people: people || [] })
        : null,
    [preview, people, assignments],
  );

  const changes = useMemo(
    () => (imported ? countChanges(preview?.assignments, imported.assignments) : 0),
    [imported, preview],
  );

  // Days left without anyone once the imported file is in place — the calendar
  // shows them as unfilled, so the "no holes" check must count the same days.
  const importedSkipped = useMemo(() => {
    if (!imported || !model) return null;
    const list = [];
    model.months.forEach((month) =>
      month.cells.forEach((cell) => {
        if (!cell.blank && cell.unfilled) list.push({ date: cell.key });
      }),
    );
    return list;
  }, [imported, model]);

  // Constraints the imported file breaks, re-checked against the new owners.
  const importedViolations = useMemo(() => {
    if (!imported || !Array.isArray(preview?.constraintViolations)) return null;
    return violationsFor({
      constraints: preview.constraints,
      assignments,
      existing: preview.existing,
    });
  }, [imported, preview, assignments]);

  // Past fairness for chags — the check under "every free day was filled":
  // the run's own fairness table (holidayTable when chags went to
  // holidayUsers, otherwise justiceTable) and the number of months before the
  // range the run took into account (preview.historyMonths). An imported file
  // has different owners than the run, so the check is shown for the run as
  // computed only.
  const runFairness = preview?.holidayTable ?? preview?.justiceTable ?? null;
  const pastOff = preview?.historyMonths === 0;
  const holidayFairness =
    !imported && !pastOff && Array.isArray(runFairness) ? runFairness : null;
  const pastFairnessNote = !preview
    ? null
    : pastOff
      ? "הוגנות העבר כבויה בחלוקה הזו — ההתחשבות בחודשים האחרונים הוגדרה ל-0."
      : imported
        ? "בדיקת הוגנות העבר מתייחסת לחלוקה שחושבה — היא לא מוצגת לקובץ מיובא."
        : !holidayFairness
          ? "בדיקת הוגנות העבר לא זמינה — טבלת ההוגנות של החלוקה לא הועברה לתצוגה."
          : null;

  const handleExport = () => {
    if (!preview) return;
    downloadCsv(
      csvFileName(preview),
      buildAssignmentsCsv({ ...preview, assignments, people: people || [] }),
    );
  };

  const handleImport = async (file) => {
    if (!preview) return;
    try {
      const text = await readCsvFile(file);
      const result = parseAssignmentsCsv(text, {
        people: people || [],
        startDate: preview.startDate,
        endDate: preview.endDate,
      });
      setImportErrors(result.errors);
      // Nothing usable in the file: keep the run on screen and just report why.
      if (!result.assignments.length && !result.cleared) {
        setImported(null);
        if (!result.errors.length) {
          setImportErrors(["לא נמצאו שורות לייבוא בקובץ."]);
        }
        return;
      }
      setImported({ fileName: file.name, assignments: result.assignments });
    } catch (e) {
      setImported(null);
      setImportErrors([e?.message || "קריאת הקובץ נכשלה."]);
    }
  };

  const resetImport = () => {
    setImported(null);
    setImportErrors([]);
  };

  const close = () => {
    // While the run is being recomputed the window stays open, so the fresh
    // result replaces the one on screen instead of popping up again later.
    if (isSaving || isRunning) return;
    setHighlight(null);
    setImported(null);
    setImportErrors([]);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        dir="rtl"
        closePosition="left-4 top-4"
        className="w-[96vw] sm:max-w-[1180px] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden text-right"
      >
        <DialogHeader className="px-4 py-3 border-b border-gray-100 shrink-0 text-right space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base md:text-lg text-gray-800">
            <CalendarRange className="w-5 h-5 text-blue-600" />
            תצוגה מקדימה — חלוקת משמרות
          </DialogTitle>
          <DialogDescription className="text-xs text-gray-500">
            {preview
              ? `${formatIL(preview.startDate)} — ${formatIL(preview.endDate)} · ${
                  assignments.length
                } משמרות · טרם נשמר דבר${
                  preview.overwrite ? " · דריסת המשמרות הקיימות בטווח" : ""
                }`
              : ""}
            {preview?.computedAt
              ? ` · חושב ${formatTime(preview.computedAt)}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {preview && (
          <DistributionPreviewCsvBar
            imported={imported}
            changes={changes}
            errors={importErrors}
            disabled={isSaving || isRunning}
            onExport={handleExport}
            onFile={handleImport}
            onReset={resetImport}
          />
        )}

        {error && (
          <div className="shrink-0 mx-3 md:mx-4 mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
            החישוב מחדש נכשל: {error}
          </div>
        )}

        {model && (
          <div className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4 space-y-3 bg-[#F9FAFB] custom-scrollbar">
            <DistributionPreviewSummary
              model={model}
              relaxations={imported ? [] : preview.relaxations}
              skipped={imported ? importedSkipped : preview.skipped}
              violations={
                imported ? importedViolations : preview.constraintViolations
              }
              holidayFairness={holidayFairness}
              historyMonths={preview.historyMonths}
              pastFairnessNote={pastFairnessNote}
            />

            <DistributionPreviewConstraints
              constraints={preview.constraints}
              ignored={ignoredConstraints}
              onDelete={onDeleteConstraint}
              onRestore={onRestoreConstraint}
              deletingId={deletingConstraintId}
              isRunning={isRunning}
              ignoredCount={ignoredCount}
              onRestoreIgnored={onRestoreIgnored}
            />

            <DistributionPreviewPeopleBar
              rows={model.rows}
              highlight={highlight}
              onHighlight={setHighlight}
            />

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <p className="text-xs font-semibold text-gray-700">
                  לוח השנה של הטווח
                </p>
                <div className="flex flex-wrap items-center gap-3 text-[10px] text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="w-3 h-3 rounded"
                      style={{ background: MARK_COLORS.existing }}
                    />
                    משובץ קיים
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="w-3 h-3 rounded"
                      style={{
                        boxShadow: `inset 0 0 0 1.5px ${MARK_COLORS.holiday}`,
                      }}
                    />
                    יום חג
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="w-3 h-3 rounded"
                      style={{ border: `1px dashed ${MARK_COLORS.warning}` }}
                    />
                    לא מאויש
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-3 h-[3px] rounded" style={{ background: MARK_COLORS.warning }} />
                    מילוי אחרון
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: MARK_COLORS.constraint }}
                    />
                    אילוץ (ריחוף למחיקה)
                  </span>
                </div>
              </div>
              <DistributionPreviewCalendar
                months={model.months}
                highlight={highlight}
                constraintByKey={model.constraintByKey}
                onDeleteConstraint={onDeleteConstraint}
                deletingId={deletingConstraintId}
                isRunning={isRunning}
              />
            </div>

            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-2.5">
              <p className="text-xs font-semibold text-gray-700 mb-1.5">
                הוגנות לכל משתמש
                <span className="text-[10px] font-normal text-gray-400 mr-2">
                  לכל תא: כמה קיבל וכמה זה רחוק מהחלק השווה
                </span>
              </p>
              <DistributionPreviewTable
                model={model}
                highlight={highlight}
                onHighlight={setHighlight}
              />
            </div>
          </div>
        )}

        <div className="shrink-0 border-t border-gray-100 bg-white px-3 md:px-4 py-3 flex flex-col-reverse sm:flex-row items-center justify-between gap-2">
          <span className="text-[11px] text-gray-500">
            {preview?.overwrite
              ? `אישור מוחק את ${preview.replaceShiftIds?.length || 0} המשמרות הקיימות בטווח ויוצר את השיבוץ החדש במקומן.`
              : "אישור יוצר את המשמרות ואת שיבוץ הבעלים בפועל ביומן."}
          </span>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              onClick={close}
              disabled={isSaving || isRunning}
              className="flex-1 sm:flex-none rounded-xl"
            >
              ביטול
            </Button>
            <Button
              variant="outline"
              onClick={onRerun}
              disabled={isSaving || isRunning}
              title={`הרצה מחדש עם אותם פרמטרים: ${formatIL(
                preview?.startDate,
              )} — ${formatIL(preview?.endDate)} · ${
                preview?.overwrite ? "עם דריסת משמרות" : "בלי דריסת משמרות"
              } · התחשבות בעבר · ${
                ignoredCount ? `${ignoredCount} אילוצים מוסרים` : "כל האילוצים"
              }`}
              className="flex-1 sm:flex-none rounded-xl gap-2 border-blue-300 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRunning ? "animate-spin" : ""}`}
              />
              {isRunning ? "מריץ מחדש..." : "הרצה מחדש (אותם פרמטרים)"}
            </Button>
            <Button
              onClick={() => onApprove(assignments)}
              disabled={
                isSaving || isRunning || !(assignments.length > 0)
              }
              className="flex-1 sm:flex-none rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {isSaving
                ? "משבץ משמרות..."
                : `אישור ושיבוץ (${assignments.length})`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}