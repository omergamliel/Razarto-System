import React, { useMemo, useState } from "react";
import { Check, Loader2, CalendarRange } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { buildPreviewModel, MARK_COLORS } from "./previewModel";
import DistributionPreviewCalendar from "./DistributionPreviewCalendar";
import DistributionPreviewPeopleBar from "./DistributionPreviewPeopleBar";
import DistributionPreviewSummary from "./DistributionPreviewSummary";
import DistributionPreviewTable from "./DistributionPreviewTable";
import DistributionPreviewConstraints from "./DistributionPreviewConstraints";

const formatIL = (iso) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").slice(0, 10));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(iso || "");
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
  onApprove,
  onClose,
}) {
  const [highlight, setHighlight] = useState(null);

  const model = useMemo(
    () => (preview ? buildPreviewModel({ ...preview, people: people || [] }) : null),
    [preview, people],
  );

  const close = () => {
    // While the run is being recomputed the window stays open, so the fresh
    // result replaces the one on screen instead of popping up again later.
    if (isSaving || isRunning) return;
    setHighlight(null);
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
                  preview.assignments?.length || 0
                } משמרות · טרם נשמר דבר${
                  preview.overwrite ? " · דריסת המשמרות הקיימות בטווח" : ""
                }`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {model && (
          <div className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4 space-y-3 bg-[#F9FAFB] custom-scrollbar">
            <DistributionPreviewSummary
              model={model}
              relaxations={preview.relaxations}
              skipped={preview.skipped}
            />

            <DistributionPreviewConstraints
              constraints={preview.constraints}
              onDelete={onDeleteConstraint}
              deletingId={deletingConstraintId}
              isRunning={isRunning}
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
                </div>
              </div>
              <DistributionPreviewCalendar
                months={model.months}
                highlight={highlight}
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
              onClick={onApprove}
              disabled={
                isSaving || isRunning || !(preview?.assignments?.length > 0)
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
                : `אישור ושיבוץ (${preview?.assignments?.length || 0})`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}