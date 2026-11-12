import React from "react";
import { Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const formatIL = (iso) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").slice(0, 10));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(iso || "");
};

/**
 * The constraints (אילוצים) this run was built around. Deleting one removes the
 * record and recomputes the same distribution, so the freed date is staffed.
 */
export default function DistributionPreviewConstraints({
  constraints,
  onDelete,
  deletingId,
  isRunning,
}) {
  if (!constraints?.length) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2">
      <p className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
        אילוצים שנשקלו בחלוקה
        <span className="text-[10px] font-normal text-gray-400 mr-1">
          מחיקת אילוץ מחשבת את החלוקה מחדש
        </span>
        {isRunning && (
          <span className="text-[10px] font-normal text-blue-600 inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> מחשב מחדש...
          </span>
        )}
      </p>
      <div className="max-h-40 overflow-y-auto custom-scrollbar divide-y divide-gray-50">
        {constraints.map((constraint) => (
          <div
            key={constraint.id}
            className="flex items-center justify-between gap-2 py-1"
          >
            <span className="text-[11px] text-gray-700 truncate min-w-0">
              {constraint.user_name}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] font-mono text-gray-500" dir="ltr">
                {formatIL(constraint.date)}
              </span>
              {constraint.note && (
                <span className="text-[10px] text-gray-400 max-w-[12rem] truncate">
                  {constraint.note}
                </span>
              )}
              <Button
                size="icon"
                variant="ghost"
                aria-label={`מחיקת האילוץ של ${constraint.user_name}`}
                onClick={() => onDelete(constraint)}
                disabled={isRunning || deletingId != null}
                className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50"
              >
                {deletingId === constraint.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}