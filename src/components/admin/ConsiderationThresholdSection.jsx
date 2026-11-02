import React from "react";
import { Button } from "@/components/ui/button";
import { Ban } from "lucide-react";

// The monthly constraint (אילוץ) threshold K. Users may set as many
// constraints as they like and they are honoured by the distribution
// immediately; when someone goes over K in a single month, the managers are
// notified here and in the notification sidebar so they can review it.
export default function ConsiderationThresholdSection({
  value,
  onChange,
  onSave,
  isSaving,
}) {
  return (
    <div className="bg-white p-4 md:p-6 rounded-2xl border border-gray-100 shadow-sm max-w-xl">
      <div className="flex items-center gap-2 mb-2">
        <Ban className="w-5 h-5 text-indigo-500" />
        <h3 className="font-bold text-gray-800">הגדרות אילוצים</h3>
      </div>
      <p className="text-sm text-gray-500 leading-relaxed mb-4">
        סף האילוצים החודשי (K). משתמשים רשאים להגדיר כמה אילוצים שירצו, והם
        נלקחים בחשבון בחלוקת המשמרות מיד וללא צורך באישור. כאשר משתמש חורג מ-K
        אילוצים בחודש בודד, המנהלים מקבלים על כך התראה (בלשונית זו ובסרגל
        ההודעות) כדי לבדוק את החריגה ולמחוק אילוצים במידת הצורך.
      </p>
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">סף אילוצים חודשי (K)</label>
          <input
            type="number"
            min="1"
            step="1"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white w-32"
            dir="ltr"
          />
        </div>
        <Button
          onClick={onSave}
          disabled={isSaving}
          className="rounded-xl h-10 bg-indigo-600 hover:bg-indigo-700 text-white"
        >
          {isSaving ? "שומר..." : "שמירה"}
        </Button>
      </div>
    </div>
  );
}