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

// ---------------------------------------------------------------------------
// Chag days on the calendar: only the chags of the user's holiday list.
//
// The calendar must mark as "chag day" exactly the days of the holiday list
// the admin built (the Holiday schema rows the distribution was given) — not
// every chag of a generic Jewish calendar. The distribution result reports
// those days (chagDates: list days only; cholHamoedUsed: Chol HaMoed kept with
// a listed chag). Whatever chag source buildPreviewModel reads, the modal
//   1. filters every chag-date collection it hands to buildPreviewModel down
//      to those days (keeping its type: Set, Array, Map or plain object), and
//   2. clears the chag marks of every calendar cell that isn't one of them —
//      so a chag computed inside previewModel itself can't slip through
//      either — and marks a list day the model didn't know about.
// ---------------------------------------------------------------------------
const DATE_KEY = /^\d{4}-\d{2}-\d{2}/;
const isDateKey = (v) => typeof v === "string" && DATE_KEY.test(v);
const dayKey = (v) => String(v).slice(0, 10);
// Names of fields/props that carry chag information.
const CHAG_FIELD = /holiday|chag|hamoed|moed/i;
// Result tables whose names match but hold no chag dates.
const NOT_CHAG_DATES = new Set(["holidayTable", "justiceTable", "holidayUsers"]);

const addDayKeys = (out, start, end, name) => {
  const first = new Date(`${dayKey(start)}T00:00:00Z`);
  const last = new Date(`${dayKey(end || start)}T00:00:00Z`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return;
  for (let d = first; d <= last; d = new Date(d.getTime() + 864e5)) {
    const key = d.toISOString().slice(0, 10);
    if (!out.has(key) || name) out.set(key, name || null);
  }
};

// The chag days of the user's holiday list → the chag's name (when known), or
// null when the preview carries no list at all (then nothing is filtered).
const listChagDays = (preview) => {
  if (!preview) return null;
  const out = new Map();
  if (Array.isArray(preview.chagDates)) {
    preview.chagDates.forEach((k) => out.set(dayKey(k), null));
    (preview.cholHamoedUsed || []).forEach((k) => out.set(dayKey(k), null));
    // the schema rows, if the preview carries them, only add the names
    (Array.isArray(preview.holidays) ? preview.holidays : []).forEach((h) => {
      if (!h?.start_date) return;
      const named = new Map();
      addDayKeys(named, h.start_date, h.end_date, String(h.name || ""));
      named.forEach((name, key) => out.has(key) && out.set(key, name));
    });
    return out;
  }
  // Older results without chagDates: the holiday-list rows the distribution
  // was given (name, start_date, end_date, divisions — the Holiday schema).
  const rows = Array.isArray(preview.holidays)
    ? preview.holidays.filter((h) => h?.start_date)
    : [];
  if (rows.length === 0) return null;
  rows.forEach((h) => addDayKeys(out, h.start_date, h.end_date, String(h.name || "")));
  return out;
};

// A chag-date collection cut down to the list days, in the same shape.
const onlyListDays = (value, allowed) => {
  const keep = (k) => allowed.has(dayKey(k));
  if (value instanceof Set) {
    const items = [...value];
    return items.length && items.every(isDateKey) ? new Set(items.filter(keep)) : value;
  }
  if (value instanceof Map) {
    const keys = [...value.keys()];
    return keys.length && keys.every(isDateKey)
      ? new Map([...value].filter(([k]) => keep(k)))
      : value;
  }
  if (Array.isArray(value)) {
    if (value.length && value.every(isDateKey)) return value.filter(keep);
    // events / rows: { date } or { start_date, end_date }
    if (value.length && value.every((x) => x && (isDateKey(x.date) || isDateKey(x.start_date)))) {
      return value.filter((x) => {
        const days = new Map();
        addDayKeys(days, x.date || x.start_date, x.end_date || x.date || x.start_date);
        return [...days.keys()].some((k) => allowed.has(k));
      });
    }
    return value;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    return keys.length && keys.every(isDateKey)
      ? Object.fromEntries(Object.entries(value).filter(([k]) => keep(k)))
      : value;
  }
  return value;
};

const filterChagFields = (obj, allowed) => {
  const out = { ...obj };
  Object.keys(out).forEach((k) => {
    if (CHAG_FIELD.test(k) && !NOT_CHAG_DATES.has(k)) out[k] = onlyListDays(out[k], allowed);
  });
  return out;
};

// The model's calendar with chag marks on the list days only.
const markListChagsOnly = (model, allowed, holidayColor) => {
  if (!model || !Array.isArray(model.months)) return model;
  const isChagMark = (x) => typeof x === "string" && /^(holiday|chag|cholhamoed)$/i.test(x);
  // Does this cell carry a chag mark (in whatever form the model uses)?
  const marked = (cell) =>
    Object.entries(cell || {}).some(
      ([k, v]) =>
        (CHAG_FIELD.test(k) && !!v && !(Array.isArray(v) && v.length === 0)) ||
        (Array.isArray(v) && v.some(isChagMark)) ||
        isChagMark(v) ||
        (holidayColor && v === holidayColor),
    );
  // How the model marks a chag: copied from a list day it did mark, onto the
  // list days it didn't (a chag the admin added that no generic calendar has).
  const allCells = model.months.flatMap((month) => month.cells || []);
  const sample = allCells.find((c) => c && !c.blank && c.key && allowed.has(keyOf(c.key)) && marked(c));
  const markLike = (cell, name) => {
    const next = { ...cell };
    Object.entries(sample).forEach(([k, v]) => {
      if (k === "key" || k === "date" || k === "blank") return;
      if (CHAG_FIELD.test(k)) {
        if (next[k]) return;
        next[k] = /name|title|label/i.test(k) && typeof v === "string" ? name || v : v;
      } else if (Array.isArray(v) && v.some(isChagMark)) {
        const marks = v.filter(isChagMark);
        next[k] = [...(Array.isArray(next[k]) ? next[k] : []), ...marks.filter((m) => !(next[k] || []).includes(m))];
      } else if (isChagMark(v) || (holidayColor && v === holidayColor)) {
        next[k] = v;
      }
    });
    return next;
  };
  const months = model.months.map((month) => ({
    ...filterChagFields(month, allowed),
    cells: (month.cells || []).map((cell) => {
      if (!cell || cell.blank || !cell.key) return cell;
      const key = keyOf(cell.key);
      if (allowed.has(key)) return sample && !marked(cell) ? markLike(cell, allowed.get(key)) : cell;
      // not a chag of the list: every chag mark off
      const next = { ...cell };
      Object.entries(cell).forEach(([k, v]) => {
        if (CHAG_FIELD.test(k)) {
          next[k] =
            typeof v === "boolean" ? false : typeof v === "number" ? 0 : Array.isArray(v) ? [] : null;
        } else if (Array.isArray(v) && v.some(isChagMark)) {
          next[k] = v.filter((x) => !isChagMark(x));
        } else if (isChagMark(v) || (holidayColor && v === holidayColor)) {
          next[k] = null;
        }
      });
      return next;
    }),
  }));
  return { ...filterChagFields(model, allowed), months };
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

  // The chag days of the user's holiday list (see listChagDays). The calendar
  // marks only these as chag days: the model gets only list days in its chag
  // inputs, and its cells are cleaned of any other chag mark.
  const allowedChagDays = useMemo(() => listChagDays(preview), [preview]);

  const model = useMemo(() => {
    if (!preview) return null;
    const input = { ...preview, assignments, people: people || [] };
    if (!allowedChagDays) return buildPreviewModel(input);
    return markListChagsOnly(
      buildPreviewModel(filterChagFields(input, allowedChagDays)),
      allowedChagDays,
      MARK_COLORS?.holiday,
    );
  }, [preview, people, assignments, allowedChagDays]);

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

  // The chag check under "every free day was filled": chags spread evenly
  // (always) and nobody given a chag they already worked (only when the run
  // looked at the past — preview.historyMonths > 0). It reads the run's own
  // fairness table (holidayTable when chags went to holidayUsers, otherwise
  // justiceTable). An imported file has different owners than the run, so the
  // check is shown for the run as computed only.
  const runFairness = preview?.holidayTable ?? preview?.justiceTable ?? null;
  const pastOff = preview?.historyMonths === 0;
  const holidayFairness =
    !imported && Array.isArray(runFairness) ? runFairness : null;
  const pastFairnessNote = !preview
    ? null
    : imported
      ? "בדיקת חלוקת החגים מתייחסת לחלוקה שחושבה — היא לא מוצגת לקובץ מיובא."
      : !holidayFairness
        ? "בדיקת חלוקת החגים לא זמינה — טבלת ההוגנות של החלוקה לא הועברה לתצוגה."
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
              chagShareCap={preview.chagShareCap}
              pastOff={pastOff}
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