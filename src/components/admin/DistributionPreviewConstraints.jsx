import React from "react";
import { Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import DistributionPreviewConstraintsByUser from "@/components/admin/DistributionPreviewConstraintsByUser";

/**
 * The constraints (אילוצים) this run was built around. Removing one here takes
 * it out of THIS run only — the request itself is not deleted anywhere — and
 * the distribution is recomputed without it.
 */
export default function DistributionPreviewConstraints({
  constraints,
  ignored = [],
  onDelete,
  deletingId,
  isRunning,
  ignoredCount = 0,
  onRestoreIgnored,
}) {
  if (!constraints?.length && !ignoredCount) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
          אילוצים שנשקלו בחלוקה
          <span className="text-[10px] font-normal text-gray-400 mr-1">
            הסרה כאן משפיעה רק על החלוקה הזו — האילוץ עצמו לא נמחק
          </span>
        </p>
        {isRunning && (
          <span className="text-[10px] font-normal text-blue-600 inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> מחשב מחדש...
          </span>
        )}
        {ignoredCount > 0 && (
          <button
            type="button"
            onClick={onRestoreIgnored}
            disabled={isRunning}
            className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 disabled:opacity-40 mr-auto"
          >
            <RotateCcw className="w-3 h-3" />
            החזרת {ignoredCount} אילוצים שהוסרו
          </button>
        )}
      </div>
      <DistributionPreviewConstraintsByUser
        constraints={constraints}
        ignored={ignored}
        onDelete={onDelete}
        deletingId={deletingId}
        isRunning={isRunning}
      />
    </div>
  );
}