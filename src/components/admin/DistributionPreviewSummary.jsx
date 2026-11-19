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

// The past period the run took into account, in words.
const pastPeriod = (months) => {
  const n = Number(months);
  if (!Number.isFinite(n) || n <= 0) return "בתקופת העבר שנלקחה בחשבון";
  if (n === 1) return "בחודש שלפני הטווח";
  if (n === 2) return "בחודשיים שלפני הטווח";
  return `ב-${n} החודשים שלפני הטווח`;
};

/**
 * Chags in this distribution, by the rule: chag shares (a share holding a day
 * of the holiday list) go first to people who worked no chag in the past
 * period, at most `cap` each (2, or more only when the head count forces it),
 * and nobody gets a chag they already worked in the past period. Only days of
 * the holiday list are counted (chagDays / chagShares from the run).
 */
function HolidaySpreadCheck({ rows, months, cap, pastOff, noPastFirst = true }) {
  if (!rows.some((r) => r.chagShares != null)) {
    return (
      <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
        <Scale className="w-3.5 h-3.5" />
        בדיקת חלוקת החגים לא זמינה לחלוקה הזו — הריצו אותה מחדש.
      </p>
    );
  }
  const people = rows.map((r) => ({
    id: r.personId,
    name: r.name,
    shares: Number(r.chagShares) || 0,
    days: Number(r.chagDays) || 0,
    // the range's chag days this person had no constraint on (null: unknown)
    freeDays: r.chagFreeDays != null ? Number(r.chagFreeDays) || 0 : null,
    pastChags: Array.isArray(r.pastChags) ? r.pastChags : [],
    repeated: Number(r.repeatedChagShares) || 0,
    repeatedChags: Array.isArray(r.repeatedChags) ? r.repeatedChags : [],
    // free for a share that should have gone to them / got such a share
    missed: Number(r.missedChagShares) || 0,
    over: Number(r.chagSharesOverOthers) || 0,
  }));
  const period = pastPeriod(months);
  const total = people.reduce((n, p) => n + p.shares, 0);
  if (total === 0) {
    return (
      <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
        <Scale className="w-3.5 h-3.5" />
        אין בטווח ימי חג מרשימת החגים — אין חגים לחלק.
      </p>
    );
  }
  const names = (list) => list.map((p) => p.name).join(" · ");
  const usePast = !pastOff && noPastFirst;
  // Blocked by constraints on every chag day of the range: they can't take any.
  const blocked = people.filter((p) => p.freeDays === 0);
  const overCap = cap != null ? people.filter((p) => p.shares > cap) : [];
  const fresh = people.filter((p) => p.pastChags.length === 0 && p.freeDays !== 0);
  const veterans = people.filter((p) => p.pastChags.length > 0);
  // A share that should have gone to someone else (the run checks it: free for
  // it, and either did no chags in the past while the holder did, or held at
  // least 2 fewer in the same group).
  const givenOver = people.filter((p) => p.over > 0);
  const passedOver = people.filter((p) => p.missed > 0);
  const repeaters = pastOff ? [] : people.filter((p) => p.repeated > 0);
  const failed = overCap.length > 0 || givenOver.length > 0 || repeaters.length > 0;

  const details = (
    <details className="mt-1" open={failed}>
      <summary className="text-[11px] text-gray-500 cursor-pointer select-none">
        פירוט לפי משתמש (בחלוקה = משמרות חג מרשימת החגים בחלוקה הזו
        {pastOff ? "" : `; עבר = החגים שעשה ${period}`})
      </summary>
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {[...people]
          .sort((a, b) => a.pastChags.length - b.pastChags.length || b.shares - a.shares)
          .map((p) => (
            <span
              key={p.id}
              className={`text-[11px] rounded-full border px-2 py-0.5 ${
                overCap.includes(p) || givenOver.includes(p) || (p.repeated > 0 && !pastOff)
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : passedOver.includes(p)
                    ? "border-sky-300 bg-sky-50 text-sky-800"
                    : "border-gray-200 bg-gray-50 text-gray-700"
              }`}
            >
              {p.name}
              <span className="text-gray-400"> · בחלוקה </span>
              <b className="font-mono">{p.shares}</b>
              <span className="text-gray-400"> ({p.days} ימים)</span>
              {!pastOff && (
                <span className="text-gray-500">
                  {" "}
                  · עבר: {p.pastChags.length > 0 ? p.pastChags.join(", ") : "לא עשה חגים"}
                </span>
              )}
              {p.repeated > 0 && !pastOff && <span> · שוב: {p.repeatedChags.join(", ")}</span>}
              {p.freeDays === 0 && <span className="text-gray-400"> · חסום בכל ימי החג</span>}
            </span>
          ))}
      </div>
    </details>
  );

  return (
    <div className={failed ? "bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" : ""}>
      {/* the cap */}
      {overCap.length === 0 ? (
        <p className="text-[11px] text-emerald-700 flex items-center gap-1.5">
          <Scale className="w-3.5 h-3.5" />
          אף אחד לא קיבל יותר מ-{cap ?? Math.max(...people.map((p) => p.shares))} משמרות חג
          {cap != null && cap > 2 ? " (יותר מ-2 כי אין מספיק אנשים לכל משמרות החג)" : ""}.
        </p>
      ) : (
        <p className="text-[11px] font-semibold text-amber-800 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          קיבלו יותר מ-{cap} משמרות חג (לא נמצא מי שיחליף בגלל אילוצים או שבוע תפוס):{" "}
          {overCap.map((p) => `${p.name} (${p.shares})`).join(" · ")}
        </p>
      )}
      {/* people with no past chags first */}
      {!usePast ? (
        pastOff && (
          <p className="text-[11px] text-gray-500 mt-1">
            ההתחשבות בעבר כבויה בחלוקה הזו — לא נבדק מי עשה חגים בעבר ומי קיבל שוב חג שכבר עשה.
          </p>
        )
      ) : givenOver.length > 0 ? (
        <>
          <p className="text-[11px] text-amber-800 mt-1 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            קיבלו משמרות חג אף שמישהו אחר היה פנוי ועדיף לו (לא עשה חגים {period}, או קיבל
            פחות): {names(givenOver)}
          </p>
          <p className="text-[11px] text-sky-800">היו פנויים וקיבלו פחות: {names(passedOver)}</p>
        </>
      ) : fresh.length === 0 ? (
        <p className="text-[11px] text-gray-500 mt-1">כולם עשו חגים {period} — אין למי לתת עדיפות.</p>
      ) : (
        <p className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          החגים הלכו קודם למי שלא עשה חגים {period} ({fresh.length} אנשים)
          {veterans.some((p) => p.shares > 0)
            ? " — מי שעשה חגים קיבל רק את מה שנשאר."
            : " — מי שעשה חגים לא קיבל חגים הפעם."}
        </p>
      )}
      {/* same chag again */}
      {!pastOff &&
        (repeaters.length > 0 ? (
          <p className="text-[11px] text-amber-800 mt-1 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            קיבלו חג שכבר עשו {period} (לא היה מי שיחליף):{" "}
            {repeaters.map((p) => `${p.name} (${p.repeatedChags.join(", ")})`).join(" · ")}
          </p>
        ) : (
          <p className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            אף אחד לא קיבל חג שכבר עשה {period}.
          </p>
        ))}
      {blocked.length > 0 && (
        <p className="text-[11px] text-gray-500 mt-1">
          לא קיבלו ימי חג כי היו חסומים באילוצים בכל ימי החג בטווח: {names(blocked)}
        </p>
      )}
      {details}
    </div>
  );
}

/**
 * The run's headline figures plus the completeness checks: every free day was
 * filled, chags went first to people with no past chags (at most 2 each)
 * without repeats, and no constraint that was left ON got broken.
 *
 * The chag check runs when `holidayFairness` is passed: the result's
 * holidayTable (or justiceTable when the run had no holidayUsers). Pass
 * `chagShareCap` (the most chag shares per person), `chagNoPastFirst` (people
 * with no past chags went first), `pastOff` (the run ignored the past, so
 * neither that nor repeats is checked) and `historyMonths` — the number of
 * months before the range the run looked at — so the check names that period.
 * When the check can't be shown, `pastFairnessNote` says why in its place.
 */
export default function DistributionPreviewSummary({
  model,
  relaxations,
  skipped,
  violations,
  holidayFairness,
  chagShareCap,
  chagNoPastFirst = true,
  pastOff = false,
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
        <HolidaySpreadCheck
          rows={holidayFairness}
          months={historyMonths}
          cap={chagShareCap ?? null}
          pastOff={pastOff}
          noPastFirst={chagNoPastFirst !== false}
        />
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