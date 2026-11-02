import React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Trash2 } from "lucide-react";
import DateFieldIL from "@/components/DateFieldIL";

// Deleting every shift of a date range — used to clear a period before a
// distribution is run again. The confirmation dialog lives in the admin modal.
export default function DeleteShiftsRangeSection({
  range,
  onChange,
  error,
  onRequest,
}) {
  return (
    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-gray-800">
            מחיקת משמרות בטווח תאריכים
          </p>
          <p className="text-xs text-gray-500 max-w-xl">
            מוחק לצמיתות את כל המשמרות בטווח שנבחר (כולל שני התאריכים). שימושי
            לניקוי טווח לפני הרצה מחדש של חלוקה הוגנת. פעולה זו אינה הפיכה.
          </p>
        </div>
        <Trash2 className="w-5 h-5 text-red-500 shrink-0" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" dir="rtl">
        <div className="grid gap-1">
          <Label className="text-sm text-gray-700">תאריך התחלה</Label>
          <DateFieldIL
            value={range.startDate}
            onChange={(iso) => onChange({ startDate: iso })}
            className="rounded-xl"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-sm text-gray-700">תאריך סיום</Label>
          <DateFieldIL
            value={range.endDate}
            onChange={(iso) => onChange({ endDate: iso })}
            className="rounded-xl"
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">
          {error}
        </p>
      )}

      <Button
        onClick={onRequest}
        variant="destructive"
        className="w-full md:w-auto mt-4 h-11 rounded-xl gap-2"
      >
        <Trash2 className="w-4 h-4" /> מחק משמרות בטווח
      </Button>
    </div>
  );
}