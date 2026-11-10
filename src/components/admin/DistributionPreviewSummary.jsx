import React from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

// Which rule the distribution had to bend, in words the admin can act on.
const RULE_LABELS = {
  weekly_cap: "משמרת שנייה באותו שבוע",
  split_block: "פיצול סוף שבוע / גוש חג",
  spacing: "ריווח קצר בין משמרות",
  total_band: "חריגה מרצועת ההוגנות",
  adjacent: "ימים צמודים",
};

function Tile({ label, value, tone }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2 flex flex-col">
      <span className="text-[10px] text-gray-400">{label}</span>
      <span
        className={`font-mono text-lg font-bold ${
          tone === "warn" ? "text-amber-600" : "text-gray-800"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export default function DistributionPreviewSummary({ model, relaxations, skipped }) {
  const ruleCounts = {};
  (relaxations || []).forEach((entry) =>
    (entry.rules || []).forEach((rule) => {
      ruleCounts[rule] = (ruleCounts[rule] || 0) + 1;
    }),
  );
  const skippedDates = (skipped || []).map((entry) => entry.date).slice(0, 12);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Tile label="משמרות בחלוקה" value={model.totals.assignments} />
        <Tile label="ימים בטווח" value={model.totals.days} />
        <Tile label="משתתפים בחלוקה" value={model.totals.pool} />
        <Tile
          label="ימים שלא שובצו"
          value={model.totals.skipped}
          tone={model.totals.skipped > 0 ? "warn" : undefined}
        />
        <Tile
          label="הקלות בכללים"
          value={(relaxations || []).length}
          tone={(relaxations || []).length > 0 ? "warn" : undefined}
        />
      </div>

      {Object.keys(ruleCounts).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-gray-400">פירוט ההקלות:</span>
          {Object.entries(ruleCounts).map(([rule, count]) => (
            <span
              key={rule}
              className="text-[11px] rounded-full border border-amber-200 bg-amber-50 text-amber-800 px-2 py-0.5"
            >
              {RULE_LABELS[rule] || rule}
              <b className="font-mono mr-1">{count}</b>
            </span>
          ))}
        </div>
      )}

      {model.totals.skipped > 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          <p className="text-[11px] font-semibold text-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            ימים שלא נמצא להם אף אדם זמין — לא ישובצו בחלוקה הזו
          </p>
          <p className="text-[11px] text-amber-800 font-mono mt-1" dir="ltr">
            {skippedDates
              .map((date) => {
                const [, month, day] = String(date).slice(0, 10).split("-");
                return `${day}/${month}`;
              })
              .join(" · ")}
            {model.totals.skipped > skippedDates.length ? " · …" : ""}
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-emerald-700 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          כל יום בטווח קיבל משמרת — אין חורים בלוח.
        </p>
      )}

      <p className="text-[11px] text-gray-400 flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        הלוח והמספרים הם התוצאה המחושבת בלבד — עד לאישור לא נכתב שום נתון,
        וביטול משאיר את היומן כפי שהוא.
      </p>
    </div>
  );
}