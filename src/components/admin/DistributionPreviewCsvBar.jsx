import React, { useRef } from "react";
import { Download, FileSpreadsheet, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Export / import of the preview's schedule as a CSV file. Importing only
 * replaces the run on screen — nothing is written until the window is approved.
 */
export default function DistributionPreviewCsvBar({
  imported,
  changes,
  errors = [],
  disabled,
  onExport,
  onFile,
  onReset,
}) {
  const inputRef = useRef(null);

  return (
    <div className="shrink-0 border-b border-gray-100 bg-gray-50/70 px-3 md:px-4 py-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
        <span className="text-[11px] font-medium text-gray-600">
          קובץ החלוקה (CSV)
        </span>

        <Button
          variant="outline"
          size="sm"
          onClick={onExport}
          disabled={disabled}
          className="h-8 rounded-lg gap-1.5 text-[11px]"
        >
          <Download className="w-3.5 h-3.5" />
          ייצוא לקובץ
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="h-8 rounded-lg gap-1.5 text-[11px] border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
        >
          <Upload className="w-3.5 h-3.5" />
          ייבוא מקובץ
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onFile(file);
          }}
        />

        {imported && (
          <>
            <span className="text-[11px] rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 px-2 py-0.5">
              מיובא: {imported.fileName} · {imported.assignments.length} משמרות
              {changes > 0 ? ` · ${changes} ימים שהשתנו` : " · ללא שינוי"}
            </span>
            <button
              type="button"
              onClick={onReset}
              disabled={disabled}
              className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800 disabled:opacity-50"
            >
              <RotateCcw className="w-3 h-3" />
              חזרה לחלוקה המקורית
            </button>
          </>
        )}

        <span className="text-[10px] text-gray-400 mr-auto">
          עריכת בעלי המשמרות בקובץ וייבואו מחדש מעדכנים את הלוח — האישור כותב את
          מה שמוצג.
        </span>
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5">
          <p className="text-[11px] font-semibold text-amber-800">
            {errors.length} שורות בקובץ לא יובאו:
          </p>
          <ul className="text-[11px] text-amber-800 list-disc pr-4 max-h-20 overflow-y-auto custom-scrollbar">
            {errors.map((message, index) => (
              <li key={`${message}-${index}`}>{message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}