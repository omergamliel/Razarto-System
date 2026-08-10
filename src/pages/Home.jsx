import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft } from "lucide-react";
import ShiftCalendar from "@/components/calendar/ShiftCalendar";
import NotificationSidebar from "@/components/sidebar/NotificationSidebar";

// ---------------------------------------------------------------------------
// App walkthrough — "סיור באתר"
//
// Everything for the guided tour lives inline here (steps catalog + the
// <AppTour /> overlay) instead of a dedicated src/components/tour/ folder,
// because the Base44 host only allows editing existing files, not adding new
// ones. Home.jsx is the natural home: it's where the overlay is mounted, next
// to the other global chrome (NotificationSidebar). The trigger is likewise
// inlined in HelpSupportModal.jsx as a window.dispatchEvent(new CustomEvent(...))
// — no shared module to import from, so the two sides just agree on the event
// name string below.
//
// Copy contract (per product request):
//   box heading = `<process> - <title>`  (process = the whole flow the feature
//   belongs to, shown as a prefix before the dash; title = an easy name for the
//   specific feature). Each step points at a real element via a data-tour attr.
// ---------------------------------------------------------------------------

const TOUR_EVENT = "razarto:start-tour";

const TOUR_STEPS = [
  {
    selector: "brand",
    process: "ברוכים הבאים",
    title: "מערכת Razarto",
    body: "המערכת לניהול משמרות והחלפות. סיור קצר זה יעבור על עיקרי המסך — אפשר לצאת בכל שלב.",
    radius: 18,
  },
  {
    selector: "user-greeting",
    process: "התמצאות",
    title: "המשתמש שלך",
    body: "כאן מופיעים שמך והתפקיד שלך, עם ברכה שמשתנה לפי שעות היום.",
  },
  {
    selector: "calendar-nav",
    process: "ניווט בלוח",
    title: "מעבר בין תצוגות ותאריכים",
    body: "החליפו בין תצוגה חודשית לשבועית, ודלגו קדימה ואחורה בעזרת החיצים.",
  },
  {
    selector: "calendar-grid",
    process: "צפייה במשמרות",
    title: "לוח המשמרות",
    body: "כל משמרת צבועה לפי מצבה. לחיצה על משמרת פותחת את פרטיה ואת הפעולות האפשריות.",
  },
  {
    selector: "kpi-switch_request",
    process: "בקשת החלפה",
    title: "התחלת בקשת החלפה",
    body: "הכפתור הסגול מתחיל תהליך החלפה: בוחרים משמרת שלכם, ואז (לא חובה) משמרת יעד להחלפה ישירה.",
  },
  {
    selector: "kpi-swap_requests",
    process: "מעקב בקשות",
    title: "בקשות להחלפה מלאה",
    body: "מונה הבקשות הפתוחות להחלפת משמרת שלמה. לחיצה פותחת את הרשימה, כולל בקשות שממתינות לתשובה שלכם.",
  },
  {
    selector: "kpi-partial_gaps",
    process: "מעקב בקשות",
    title: "בקשות להחלפה חלקית",
    body: "בקשות לכיסוי חלק ממשמרת ופערים שנותרו פתוחים — כאן אפשר להציע לכסות שעות בודדות.",
  },
  {
    selector: "kpi-approved",
    process: "מעקב בקשות",
    title: "היסטוריית החלפות",
    body: "כל ההחלפות שנסגרו והבקשות שהושלמו, לצפייה ולמעקב.",
  },
  {
    selector: "kpi-my_shifts",
    process: "המשמרות שלי",
    title: "המשמרות העתידיות שלי",
    body: "ספירה מהירה של המשמרות הקרובות שלכם — כולל משמרות שקיבלתם בכיסוי.",
  },
  {
    selector: "notif-button",
    process: "התראות",
    title: "מרכז ההתראות",
    body: "כאן יופיעו התראות על פעולות של אחרים שרלוונטיות אליכם — למשל הצעת החלפה שנשלחה אליכם.",
    radius: 999,
  },
  {
    selector: "hall-of-fame",
    process: "קהילה והוקרה",
    title: "היכל התהילה",
    body: "מי תרם הכי הרבה החלפות וכיסויים — הכירו את התורמים המובילים.",
  },
  {
    selector: "fairness",
    process: "קהילה והוקרה",
    title: "טבלת ההוגנות",
    body: "מבט מאוזן על מי נתן וקיבל החלפות, לשמירה על חלוקה הוגנת.",
  },
  {
    selector: "help",
    process: "עזרה ותמיכה",
    title: "מרכז העזרה",
    body: "שאלות נפוצות, סרטון הדרכה ופנייה לתמיכה — וגם את הסיור הזה, בכל עת.",
  },
];

const TIP_WIDTH = 320; // px; clamped to viewport via max-width in the markup
const HIGHLIGHT_PAD = 8; // breathing room around the spotlighted element
const GAP = 14; // distance between spotlight and the explanation box
const EDGE = 16; // min distance any floating piece keeps from the screen edge

function getEl(selector) {
  if (!selector) return null;
  return document.querySelector(`[data-tour="${selector}"]`);
}

// Guided walkthrough overlay. Stays inert until a `razarto:start-tour` event
// fires, then spotlights each target in turn with a transparent-black mask and
// an explanation box. The mask is a single element sized to the target with a
// very large box-shadow spread — the shadow paints everything *outside* the
// target dark, leaving it as a clear "spotlight", and animates smoothly as the
// highlight moves between steps (no SVG mask needed).
function AppTour() {
  // The subset of TOUR_STEPS whose target actually exists right now.
  const [steps, setSteps] = useState([]);
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [rect, setRect] = useState(null); // spotlight box, viewport coords
  const [tipPos, setTipPos] = useState(null); // {top,left,placement}
  const tipRef = useRef(null);

  const step = running ? steps[index] : null;

  const stop = useCallback(() => {
    setRunning(false);
    setRect(null);
    setTipPos(null);
    setIndex(0);
  }, []);

  // Measure the current step's target and store its viewport rect.
  const measure = useCallback(() => {
    const current = steps[index];
    const el = getEl(current?.selector);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [steps, index]);

  // Launch: build the live step list (skipping missing targets) and start.
  useEffect(() => {
    const onStart = () => {
      const live = TOUR_STEPS.filter((s) => getEl(s.selector));
      if (live.length === 0) return;
      setSteps(live);
      setIndex(0);
      setRunning(true);
    };
    window.addEventListener(TOUR_EVENT, onStart);
    return () => window.removeEventListener(TOUR_EVENT, onStart);
  }, []);

  // On each step: bring the target into view, then measure (twice, so we catch
  // the position both before and after any smooth-scroll settles).
  useEffect(() => {
    if (!running) return;
    const el = getEl(steps[index]?.selector);
    if (!el) {
      measure();
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    measure();
    const t = setTimeout(measure, 380);
    return () => clearTimeout(t);
  }, [running, index, steps, measure]);

  // Keep the spotlight glued to the target while scrolling/resizing.
  useEffect(() => {
    if (!running) return;
    const onMove = () => measure();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [running, measure]);

  // Position the explanation box relative to the spotlight: below by default,
  // above if it would overflow the bottom, always clamped inside the viewport.
  useLayoutEffect(() => {
    if (!running || !rect) {
      setTipPos(null);
      return;
    }
    const tipH = tipRef.current?.offsetHeight || 180;
    const tipW = tipRef.current?.offsetWidth || TIP_WIDTH;
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    let top = rect.top + rect.height + GAP;
    let placement = "bottom";
    if (top + tipH > vh - EDGE) {
      const above = rect.top - GAP - tipH;
      if (above >= EDGE) {
        top = above;
        placement = "top";
      } else {
        // No room above or below — clamp to bottom edge and overlap gently.
        top = Math.max(EDGE, vh - EDGE - tipH);
        placement = "bottom";
      }
    }

    let left = rect.left + rect.width / 2 - tipW / 2;
    left = Math.min(Math.max(left, EDGE), vw - EDGE - tipW);

    setTipPos({ top, left, placement });
  }, [running, rect, index]);

  const isLast = index >= steps.length - 1;
  const next = useCallback(() => {
    if (isLast) stop();
    else setIndex((i) => i + 1);
  }, [isLast, stop]);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Keyboard: Esc exits, arrows / Enter navigate.
  useEffect(() => {
    if (!running) return;
    const onKey = (e) => {
      if (e.key === "Escape") stop();
      else if (e.key === "Enter" || e.key === "ArrowLeft") next();
      else if (e.key === "ArrowRight") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, next, prev, stop]);

  if (!running || !step) return null;

  const radius = step.radius ?? 14;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0"
        style={{ zIndex: 100000 }}
        dir="rtl"
        aria-live="polite"
      >
        {/* Click-blocker: swallows interaction with the app underneath so the
            tour stays in control. Clicking the dark area advances the tour. */}
        <div className="absolute inset-0" onClick={next} />

        {/* Spotlight + transparent-black mask (the big box-shadow is the mask). */}
        {rect && (
          <motion.div
            initial={false}
            animate={{
              top: rect.top - HIGHLIGHT_PAD,
              left: rect.left - HIGHLIGHT_PAD,
              width: rect.width + HIGHLIGHT_PAD * 2,
              height: rect.height + HIGHLIGHT_PAD * 2,
            }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="absolute pointer-events-none"
            style={{
              borderRadius: radius,
              boxShadow:
                "0 0 0 9999px rgba(0,0,0,0.72), 0 0 0 3px rgba(255,255,255,0.9)",
            }}
          />
        )}

        {/* Explanation box */}
        <motion.div
          ref={tipRef}
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: tipPos ? 1 : 0, y: tipPos ? 0 : 8 }}
          className="absolute bg-white rounded-2xl shadow-2xl border border-gray-100 p-5"
          style={{
            width: TIP_WIDTH,
            maxWidth: "calc(100vw - 32px)",
            top: tipPos ? tipPos.top : rect ? rect.top + rect.height + GAP : EDGE,
            left: tipPos
              ? tipPos.left
              : rect
                ? Math.min(
                    Math.max(rect.left + rect.width / 2 - TIP_WIDTH / 2, EDGE),
                    window.innerWidth - EDGE - TIP_WIDTH,
                  )
                : EDGE,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={stop}
            aria-label="סגירת הסיור"
            className="absolute top-3 left-3 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Heading: "<process> - <feature>" (dash-separated, per request) */}
          <div className="mb-2 pl-6">
            <h3 className="text-base md:text-lg font-extrabold leading-snug">
              <span className="text-blue-500">{step.process}</span>
              <span className="text-gray-300"> - </span>
              <span className="text-gray-900">{step.title}</span>
            </h3>
          </div>

          <p className="text-sm text-gray-600 leading-relaxed">{step.body}</p>

          {/* Footer: progress + navigation */}
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-gray-400 tabular-nums">
              {index + 1} / {steps.length}
            </span>
            <div className="flex items-center gap-2">
              {index > 0 && (
                <button
                  onClick={prev}
                  className="px-3 py-2 rounded-xl text-sm font-semibold text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  הקודם
                </button>
              )}
              <button
                onClick={next}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-bold text-white bg-blue-500 hover:bg-blue-600 shadow-md transition-colors"
              >
                {isLast ? "סיום" : "הבא"}
                {!isLast && <ChevronLeft className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default function Home() {
  return (
    <>
      <ShiftCalendar />
      <NotificationSidebar />
      <AppTour />

      {/* זכויות יוצרים - קבוע למטה בצד שמאל */}
      <div
        className="fixed bottom-2 left-4 text-[10px] text-gray-400 font-medium select-none z-50 opacity-70 hover:opacity-100 transition-opacity"
        dir="rtl"
      >
        © פותח ע״י ענף דיגיטל {new Date().getFullYear()}
      </div>
    </>
  );
}
