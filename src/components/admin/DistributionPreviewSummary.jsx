import React from "react";
import { AlertTriangle, CheckCircle2, Info, Scale, ShieldCheck } from "lucide-react";

// Which rule the distribution had to bend, in words the admin can act on.
const RULE_LABELS = {
  weekly_cap: "משמרת שנייה באותו שבוע",
  split_block: "פיצול סוף שבוע / גוש חג",
  spacing: "ריווח קצר בין משמרות",
  total_band: "חריגה מרצועת ההוגנות",
  adjacent: "ימים צמודים",
};

const shortDate = (iso) => {
  const [, month, day] = String(iso || "").slice(0, 10).split("-");
  return day && month ? `${day}/${month}` : String(iso || "");
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

// "+2.5" / "−1.5" / "0": a person's chag carry from the past period.
const signed = (x) => {
  const v = Math.round((Number(x) || 0) * 10) / 10;
  return v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "0";
};

// The past period the run took into account, in words.
const pastPeriod = (months) => {
  const n = Number(months);
  if (!Number.isFinite(n) || n <= 0) return "בתקופת העבר שנלקחה בחשבון";
  if (n === 1) return "בחודש שלפני הטווח";
  if (n === 2) return "בחודשיים שלפני הטווח";
  return `ב-${n} החודשים שלפני הטווח`;
};

/**
 * Past fairness for chags: each person's carry (chag days beyond their fair
 * share in the past period — positive: did more, negative: did fewer) plus
 * the chag days they got now. By the rule, chags go first to whoever is owed.
 * It fails when someone who was already above the group's average from the
 * past ALONE still got chag days.
 */
function PastFairnessCheck({ rows, months }) {
  const people = rows.map((r) => {
    const carry = Number(r.holidayCarry) || 0;
    // chag days in this distribution — only days of the holiday list (older
    // results without chagDays fall back to every chag-block day)
    const now = Number(r.chagDays ?? r.holidays) || 0;
    // whole number of holiday-list chag days worked in the past period (older
    // results without it fall back to the difference from the fair share)
    const past = r.pastHolidays != null ? Number(r.pastHolidays) || 0 : null;
    // which chags they worked in that period, by name
    const chags = Array.isArray(r.pastChags) ? r.pastChags : [];
    return {
      id: r.personId,
      name: r.name,
      carry,
      past,
      chags,
      now,
      total: carry + now,
      // the range's chag days this person had no constraint on
      freeDays: r.chagFreeDays != null ? Number(r.chagFreeDays) || 0 : null,
      // shares they were free for but that went to someone with more past chags
      missed: Number(r.missedChagShares) || 0,
      // shares they got although someone with fewer past chags was free for them
      over: Number(r.chagSharesOverOthers) || 0,
    };
  });
  const period = pastPeriod(months);
  if (!people.some((p) => Math.abs(p.carry) > 0.05)) {
    return (
      <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
        <Scale className="w-3.5 h-3.5" />
        לא היו משמרות חג מרשימת החגים {period} — אין הוגנות עבר לבדוק בחלוקה הזו.
      </p>
    );
  }
  // The run reports, per share, whether someone with fewer past chags who got
  // no chag day was free for it (no constraint, no saved shift that week, not
  // the same chag as before). That is the failure; older results without it
  // fall back to comparing each person's share.
  const exact = rows.some((r) => r.missedChagShares != null);
  const average = people.reduce((n, p) => n + p.total, 0) / people.length;
  const byCarry = [...people].sort((a, b) => b.carry - a.carry || a.now - b.now);
  const givenOver = exact
    ? byCarry.filter((p) => p.over > 0)
    : byCarry.filter((p) => p.now > 0 && p.carry >= average + 0.5);
  const passedOver = exact
    ? [...people].sort((a, b) => a.carry - b.carry).filter((p) => p.missed > 0)
    : [...people].sort((a, b) => a.total - b.total).filter((p) => p.now === 0 && p.total <= average - 1);
  // No chag day only because a constraint covered every chag day of the range.
  const blocked = [...people]
    .sort((a, b) => a.carry - b.carry)
    .filter((p) => p.now === 0 && p.freeDays === 0 && p.carry < 0);
  const failed = givenOver.length > 0;

  const pastOf = (p) => (p.past != null ? p.past : signed(p.carry));
  const withChags = (p) =>
    `${p.name} (עבר ${pastOf(p)}${p.chags.length ? `: ${p.chags.join(", ")}` : ""})`;
  const details = (
    <details className="mt-1" open={failed}>
      <summary className="text-[11px] text-gray-500 cursor-pointer select-none">
        פירוט לפי משתמש (עבר = ימי חג מרשימת החגים {period}; בחלוקה = ימי חג
        מהרשימה בחלוקה הזו)
      </summary>
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {byCarry.map((p) => (
          <span
            key={p.id}
            className={`text-[11px] rounded-full border px-2 py-0.5 ${
              givenOver.includes(p)
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : passedOver.includes(p) && failed
                  ? "border-sky-300 bg-sky-50 text-sky-800"
                  : "border-gray-200 bg-gray-50 text-gray-700"
            }`}
          >
            {p.name}
            <span className="text-gray-400"> · עבר </span>
            {p.past != null ? (
              <b className="font-mono">{p.past}</b>
            ) : (
              <bdi dir="ltr" className="font-mono">{signed(p.carry)}</bdi>
            )}
            {p.chags.length > 0 && (
              <span className="text-gray-500"> ({p.chags.join(", ")})</span>
            )}
            <span className="text-gray-400"> · בחלוקה </span>
            <b className="font-mono">{p.now}</b>
            {p.now === 0 && p.freeDays === 0 && (
              <span className="text-gray-400"> · חסום בכל ימי החג</span>
            )}
          </span>
        ))}
      </div>
    </details>
  );
  const blockedNote = blocked.length > 0 && (
    <p className="text-[11px] text-gray-500 mt-1">
      לא קיבלו ימי חג כי היו חסומים באילוצים בכל ימי החג בטווח:{" "}
      {blocked.map((p) => p.name).join(" · ")}
    </p>
  );

  return failed ? (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
      <p className="text-[11px] font-semibold text-amber-800 flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5" />
        הוגנות העבר בחגים לא נשמרה במלואה ({period})
      </p>
      <p className="text-[11px] text-amber-800 mt-1">
        {exact
          ? "קיבלו ימי חג אף שמי שעשה פחות חגים ולא קיבל אף יום חג היה פנוי להם: "
          : "קיבלו ימי חג אף שכבר עשו יותר מחלקם: "}
        {givenOver.map(withChags).join(" · ")}
      </p>
      {passedOver.length > 0 && (
        <p className="text-[11px] text-sky-800">
          {exact
            ? "היו פנויים ולא קיבלו אף יום חג: "
            : "לא קיבלו ימי חג אף שהגיע להם: "}
          {passedOver.map(withChags).join(" · ")}
        </p>
      )}
      {blockedNote}
      {details}
    </div>
  ) : (
    <div>
      <p className="text-[11px] text-emerald-700 flex items-center gap-1.5">
        <Scale className="w-3.5 h-3.5" />
        הוגנות העבר נשמרה — ימי החג הלכו קודם למי שעשה פחות חגים {period}.
      </p>
      {blockedNote}
      {details}
    </div>
  );
}

/**
 * The run's headline figures plus the completeness checks: every free day was
 * filled, past fairness for chags held, and no constraint that was left ON got
 * broken.
 *
 * Past fairness is checked when `holidayFairness` is passed: the result's
 * holidayTable (or justiceTable when the run had no holidayUsers). Pass
 * `historyMonths` too — the number of months before the range the run took
 * into account for past fairness — so the check names that period. When the
 * check can't be shown, `pastFairnessNote` says why in its place.
 */
export default function DistributionPreviewSummary({
  model,
  relaxations,
  skipped,
  violations,
  holidayFairness,
  historyMonths,
  pastFairnessNote,
}) {
  const ruleCounts = {};
  (relaxations || []).forEach((entry) =>
    (entry.rules || []).forEach((rule) => {
      ruleCounts[rule] = (ruleCounts[rule] || 0) + 1;
    }),
  );
  const skippedDates = (skipped || []).map((entry) => entry.date).slice(0, 12);
  // undefined/null when this run ignored constraints altogether — then there is
  // nothing to check.
  const brokenConstraints = Array.isArray(violations) ? violations : null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Tile label="משמרות בחלוקה" value={model.totals.assignments} />
        <Tile label="משובצים קיימים" value={model.totals.existing} />
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
            {skippedDates.map(shortDate).join(" · ")}
            {model.totals.skipped > skippedDates.length ? " · …" : ""}
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-emerald-700 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {model.totals.assignments === 0
            ? "אין ימים פנויים בטווח — כל הימים כבר משובצים ביומן (מוצגים באפור)."
            : "כל יום פנוי בטווח שובץ — אין חורים בלוח."}
        </p>
      )}

      {Array.isArray(holidayFairness) && holidayFairness.length > 0 ? (
        <PastFairnessCheck rows={holidayFairness} months={historyMonths} />
      ) : pastFairnessNote ? (
        <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
          <Scale className="w-3.5 h-3.5" />
          {pastFairnessNote}
        </p>
      ) : null}

      {brokenConstraints &&
        (brokenConstraints.length > 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <p className="text-[11px] font-semibold text-amber-800 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {brokenConstraints.length} אילוצים שלא כובו נשברו בלוח
            </p>
            <p className="text-[11px] text-amber-800 font-mono mt-1">
              {brokenConstraints
                .slice(0, 10)
                .map((entry) => `${entry.user_name} ${shortDate(entry.date)}`)
                .join(" · ")}
              {brokenConstraints.length > 10 ? " · …" : ""}
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-emerald-700 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            אף אילוץ שלא כובה לא נשבר — כל מי שביקש יום פנוי לא שובץ בו.
          </p>
        ))}

      <p className="text-[11px] text-gray-400 flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        הלוח והמספרים הם התוצאה המחושבת בלבד — עד לאישור לא נכתב שום נתון,
        וביטול משאיר את היומן כפי שהוא.
      </p>
    </div>
  );
}