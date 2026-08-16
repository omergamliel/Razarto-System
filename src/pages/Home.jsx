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
// — no shared module to import from, so the sides agree on the event names.
//
// READ-ONLY GUARANTEE: some steps open real menus (the KPI list on a given tab,
// the switch-flow band) so the user can see them, by dispatching
// `razarto:tour-control` which ShiftCalendar handles. That only toggles UI
// state — no entity is ever created/updated/deleted — and the overlay renders a
// full-screen click-blocker above those menus, so their own action buttons
// (accept / cancel / confirm) cannot be triggered while the tour is running.
//
// Copy contract: box heading = `<process> - <title>` (process = the whole flow
// the feature belongs to, shown as a prefix before the dash; title = an easy
// name for the specific feature).
// ---------------------------------------------------------------------------

const TOUR_EVENT = "razarto:start-tour";
const TOUR_CONTROL_EVENT = "razarto:tour-control"; // → ShiftCalendar (KPI list / switch band)
const TOUR_NOTIF_EVENT = "razarto:tour-notif"; // → NotificationSidebar (panel open/close)

// Optional per-step UI drivers, dispatched when a step is entered so the tour
// can spotlight a real menu:
//   control: { open: "kpi"|"switchflow"|null, kpiType?, kpiTab?, demo? }  (ShiftCalendar)
//   notif:   true                                                          (open the notifications panel)
// A step without either implicitly closes every tour-opened surface.
//
// `demo: true` (on a KPI control, or implied for the notifications steps) tells
// the target surface to render make-believe example rows in different stages
// instead of the account's real (often empty) data — so the walkthrough always
// shows a populated list. It's read-only synthetic data; nothing is persisted.
const TOUR_STEPS = [
  {
    selector: "brand",
    process: "ברוכים הבאים",
    title: "מערכת Razarto",
    body: "המערכת לניהול משמרות והחלפות. סיור זה יעבור צעד-אחר-צעד על כל תהליכי הבקשות — יצירה, קבלה, ביטול — ועל ההודעות שכל פעולה שולחת. אפשר לצאת בכל שלב.",
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
    body: "כל משמרת צבועה לפי מצבה — הצבעים מוסברים במקרא שמעל הלוח. לחיצה על משמרת פותחת את חלון 'פעולות על המשמרת'.",
  },

  // ---- CREATING A REQUEST -------------------------------------------------
  {
    selector: "calendar-grid",
    process: "יצירת בקשה",
    title: "חלון הפעולות של משמרת",
    body: "בחלון שנפתח בלחיצה על משמרת יש כפתור אדום אחד — 'בקשת החלפה מלאה/חלקית'. הוא נקודת הכניסה לכל התהליכים: החלפה ראש-בראש, בקשה כללית, כיסוי חלקי או מתנה. 'ביטול' סוגר בלי לשלוח.",
  },
  {
    selector: "kpi-band",
    process: "לוח מחוונים",
    title: "מוני הבקשות וכפתור הפעולה",
    body: "ארבעה מונים חיים — בקשות מלאה, בקשות חלקית, היסטוריה, והמשמרות שלי — לצד הכפתור הסגול 'בקש החלפה'. לחיצה על מונה פותחת את הרשימה שלו; נראה כל אחת מהן מיד.",
  },
  {
    selector: "kpi-switch_request",
    process: "בקשת החלפה",
    title: "כפתור התחלת התהליך",
    body: "הכפתור הסגול 'בקש החלפה' מפעיל את מסלול בחירת המשמרות בתחתית המסך. נפתח אותו עכשיו.",
  },
  {
    selector: "switch-band",
    process: "בקשת החלפה",
    title: "שלב 1 — בחירת המשמרות שלי",
    body: "בפס התחתון: מסמנים בלוח את המשמרת/ות שלכם שתרצו להעביר (המונה מתעדכן), ולוחצים על הכפתור הלבן 'המשך'. 'ביטול' יוצא מהתהליך. (תצוגה בלבד — לא נשלחת בקשה.)",
    control: { open: "switchflow" },
    radius: 10,
  },
  {
    selector: "switch-band",
    process: "בקשת החלפה",
    title: "שלב 2 — יעד או בקשה כללית",
    body: "בשלב היעד יש שתי דרכים: בחירת משמרת של אדם אחר ואז 'אישור ושליחה' — הצעת החלפה ראש-בראש ישירות מולו; או 'שלח כבקשה כללית' — פתיחת הבקשה לכולם, כך שכל אחד יוכל לקחת אותה.",
    control: { open: "switchflow" },
    radius: 10,
  },

  // ---- BROWSING & ACCEPTING REQUESTS -------------------------------------
  {
    selector: "kpi-modal",
    process: "מעקב בקשות",
    title: "כל הבקשות הפתוחות",
    body: "לשונית 'כל הבקשות' מרכזת כל בקשה פתוחה. תגית בכל שורה מציינת את סוגה: כללית / ראש בראש / מלאה / מתנה. בבקשה שאתם יכולים לקחת יופיע כפתור פעולה בקצה השורה. (השורות כאן הן דוגמאות להמחשה.)",
    control: { open: "kpi", kpiType: "swap_requests", kpiTab: "all", demo: true },
    radius: 20,
  },
  {
    selector: "kpi-modal",
    process: "קבלת בקשה כללית",
    title: "לקיחת בקשה פתוחה",
    body: "בבקשה כללית של אדם אחר יופיעו שני כפתורים: 'קח את המשמרות' (ירוק) — לוקח אותה על עצמכם; או 'הצע ראש בראש' (סגול) — מציע לו משמרת שלכם בתמורה. (דוגמה להמחשה.)",
    control: { open: "kpi", kpiType: "swap_requests", kpiTab: "all", demo: true },
    radius: 20,
  },
  {
    selector: "kpi-modal",
    process: "קבלת בקשות",
    title: "בקשות אליי — החלפה ראש-בראש",
    body: "בלשונית 'בקשות אליי' מרוכזות בקשות שממתינות לתשובתכם. בהחלפה ראש-בראש שהוצעה לכם: הכפתור הירוק 'קבל' מאשר את ההחלפה, וכפתור ה-X האדום דוחה אותה. (דוגמה להמחשה.)",
    control: {
      open: "kpi",
      kpiType: "swap_requests",
      kpiTab: "incoming",
      demo: true,
    },
    radius: 20,
  },
  {
    selector: "kpi-modal",
    process: "קבלת מתנה",
    title: "בקשות אליי — מתנה",
    body: "כשמישהו מציע לקחת את המשמרת שלכם במתנה, באותה לשונית יופיע הכפתור הוורוד 'קבל מתנה' — אישורו משחרר אתכם מהמשמרת ומעביר אותה אליו. כפתור ה-X האדום דוחה את ההצעה. (דוגמה להמחשה.)",
    control: {
      open: "kpi",
      kpiType: "swap_requests",
      kpiTab: "incoming",
      demo: true,
    },
    radius: 20,
  },
  {
    selector: "kpi-modal",
    process: "ניהול הבקשות שלי",
    title: "ביטול ושיתוף חוזר",
    body: "בלשונית 'הבקשות שלי' מופיעות הבקשות שפתחתם. כפתור ה-X מבטל בקשה שכבר אינה רלוונטית, וכפתור הוואטסאפ הירוק משתף אותה שוב לתזכורת. (דוגמה להמחשה.)",
    control: { open: "kpi", kpiType: "swap_requests", kpiTab: "mine", demo: true },
    radius: 20,
  },

  // ---- PARTIAL COVERAGE ---------------------------------------------------
  {
    selector: "kpi-modal",
    process: "כיסוי חלקי",
    title: "כל הפערים — הצעת כיסוי",
    body: "פערים שאפשר לכסות בהם שעות בודדות. הפס הצבעוני בכל שורה מראה מה כבר מכוסה (בשמות המכסים) ומה עדיין פנוי. הכפתור 'אחליף' פותח את מסך בחירת השעות לכיסוי. (דוגמאות להמחשה.)",
    control: { open: "kpi", kpiType: "partial_gaps", kpiTab: "all", demo: true },
    radius: 20,
  },
  {
    selector: "kpi-modal",
    process: "כיסוי חלקי",
    title: "מה שאני מכסה",
    body: "לשונית 'מה שאני מכסה' מרכזת את הפערים שכבר לקחתם על עצמכם לכסות — למעקב אחר ההתחייבויות שלכם. (דוגמה להמחשה.)",
    control: {
      open: "kpi",
      kpiType: "partial_gaps",
      kpiTab: "covering",
      demo: true,
    },
    radius: 20,
  },
  {
    selector: "kpi-modal",
    process: "כיסוי חלקי",
    title: "הפערים שלי",
    body: "לשונית 'הפערים שלי' — פערים במשמרות שלכם שאתם מבקשים שיכוסו. כפתור ה-X מבטל את בקשת הכיסוי. (דוגמה להמחשה.)",
    control: { open: "kpi", kpiType: "partial_gaps", kpiTab: "mine", demo: true },
    radius: 20,
  },

  // ---- HISTORY ------------------------------------------------------------
  {
    selector: "kpi-modal",
    process: "היסטוריה",
    title: "החלפות שהושלמו",
    body: "כל ההחלפות שנסגרו והבקשות שהושלמו, מרוכזות כאן למעקב ולתיעוד. (דוגמאות להמחשה.)",
    control: { open: "kpi", kpiType: "approved", kpiTab: "all", demo: true },
    radius: 20,
  },

  // ---- SIDEBAR MESSAGES (NOTIFICATIONS) -----------------------------------
  {
    selector: "notif-button",
    process: "התראות",
    title: "כפתור מרכז ההודעות",
    body: "הכפתור הצף בפינה הימנית-תחתונה פותח את מרכז ההודעות. נקודה כחולה עליו מסמנת שיש הודעה חדשה שטרם נצפתה.",
    radius: 999,
  },
  {
    selector: "notif-panel",
    process: "התראות",
    title: "רשימת ההודעות",
    body: "כל פעולה שקשורה אליכם שולחת לכאן הודעה. כל הודעה צבועה לפי סוג המשמרת, ובתוכה כפתור שקופץ ישר לרשימה הרלוונטית. אפשר להסיר הודעה בודדת ב-X, או 'נקה הכל' מהכותרת. (ההודעות כאן לדוגמה.)",
    notif: true,
    radius: 16,
  },
  {
    selector: "notif-panel",
    process: "התראות",
    title: "הודעה לכל סוג בקשה",
    body: "אדום — הוצעה לכם החלפה ראש-בראש. ורוד — הוצעה לכם מתנה. צהוב — הוצע כיסוי לפער במשמרת שלכם. ירוק — המשמרת שלכם כוסתה, אין צורך להגיע. אפור — תזכורת שבקשה שפתחתם עדיין ממתינה. הכפתור בכל הודעה מוביל ל'בקשות אליי' או 'הבקשות שלי' המתאימות — כך סוגרים כל תהליך.",
    notif: true,
    radius: 16,
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

// Explicit copy of Tailwind's default `font-sans` stack. The tour box lives as
// a sibling of the app root and the host (Base44) wraps the app in a container
// that injects its own `<container> h3 { font-family: … }` rule — specificity
// (0,1,1) — which OUTRANKS our `.font-sans` class (0,1,0), so the class alone
// can't win on the title. An inline style beats any selector short of
// !important, so we set the family inline on every text node in the box. This
// is the same stack `font-sans` would have resolved to, so it stays identical
// to the rest of the app.
const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';

function getEl(selector) {
  if (!selector) return null;
  return document.querySelector(`[data-tour="${selector}"]`);
}

// Drive the app's real menus for a step (or close everything when step is null):
// the KPI list / switch band (ShiftCalendar) and the notifications panel.
function applyStepUI(step) {
  window.dispatchEvent(
    new CustomEvent(TOUR_CONTROL_EVENT, {
      detail: step?.control || { open: null },
    }),
  );
  window.dispatchEvent(
    new CustomEvent(TOUR_NOTIF_EVENT, {
      // The notifications steps always run in demo mode so the panel shows a
      // representative set of example notifications instead of the (possibly
      // empty) real feed.
      detail: { open: !!step?.notif, demo: !!step?.notif },
    }),
  );
}

// Guided walkthrough overlay. Stays inert until a `razarto:start-tour` event
// fires, then spotlights each target in turn with a transparent-black mask and
// an explanation box. The mask is a single element sized to the target with a
// very large box-shadow spread — the shadow paints everything *outside* the
// target dark, leaving it as a clear "spotlight", and animates smoothly as the
// highlight moves between steps (no SVG mask needed).
function AppTour() {
  // The subset of TOUR_STEPS whose target actually exists / can be opened.
  const [steps, setSteps] = useState([]);
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [rect, setRect] = useState(null); // spotlight box, viewport coords
  const [tipPos, setTipPos] = useState(null); // {top,left}
  const tipRef = useRef(null);

  const step = running ? steps[index] : null;

  const stop = useCallback(() => {
    applyStepUI(null); // close any menu/panel the tour opened
    setRunning(false);
    setRect(null);
    setTipPos(null);
    setIndex(0);
  }, []);

  // Measure the current step's target and store its viewport rect.
  const measure = useCallback(() => {
    const el = getEl(steps[index]?.selector);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [steps, index]);

  // Launch: a step is "live" if its target exists now, or if it opens its own
  // menu (control) — those targets mount a moment later and are polled for.
  useEffect(() => {
    const onStart = () => {
      // A step is live if its target exists now, or if it opens its own surface
      // (control / notif) whose target mounts a moment later and is polled for.
      const live = TOUR_STEPS.filter(
        (s) => s.control || s.notif || getEl(s.selector),
      );
      if (live.length === 0) return;
      setSteps(live);
      setIndex(0);
      setRunning(true);
    };
    window.addEventListener(TOUR_EVENT, onStart);
    return () => window.removeEventListener(TOUR_EVENT, onStart);
  }, []);

  // On each step: drive the app UI (open/close the relevant menu), then poll
  // until the target element exists, scroll it into view, and track it through
  // any entry animation (modal scale / band slide-up) for ~0.8s.
  useEffect(() => {
    if (!running) return;
    const current = steps[index];
    applyStepUI(current);

    let cancelled = false;
    let rafId = 0;
    let tries = 0;

    const track = (el) => {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      const t0 = performance.now();
      const loop = () => {
        if (cancelled) return;
        measure();
        if (performance.now() - t0 < 800) rafId = requestAnimationFrame(loop);
      };
      loop();
    };

    const findThenTrack = () => {
      if (cancelled) return;
      const el = getEl(current.selector);
      if (el) {
        track(el);
        return;
      }
      tries += 1;
      if (tries < 60) rafId = requestAnimationFrame(findThenTrack);
      else measure(); // give up → tooltip shows at fallback position
    };

    // Small delay so a menu/panel dispatched above has a frame to mount.
    const startT = setTimeout(
      findThenTrack,
      current.control || current.notif ? 80 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(startT);
      if (rafId) cancelAnimationFrame(rafId);
    };
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

  // Position the explanation box relative to the spotlight. Preference order:
  // below → above → beside (left/right) → pinned to the bottom edge (overlapping
  // a large target). Always clamped fully inside the viewport.
  useLayoutEffect(() => {
    if (!running || !rect) {
      setTipPos(null);
      return;
    }
    const tipH = tipRef.current?.offsetHeight || 180;
    const tipW = tipRef.current?.offsetWidth || TIP_WIDTH;
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    const clampX = (x) => Math.min(Math.max(x, EDGE), vw - EDGE - tipW);
    const clampY = (y) => Math.min(Math.max(y, EDGE), vh - EDGE - tipH);
    const centerX = clampX(rect.left + rect.width / 2 - tipW / 2);
    const centerY = clampY(rect.top + rect.height / 2 - tipH / 2);

    const spaceBelow = vh - (rect.top + rect.height) - GAP - EDGE;
    const spaceAbove = rect.top - GAP - EDGE;
    const spaceLeft = rect.left - GAP - EDGE;
    const spaceRight = vw - (rect.left + rect.width) - GAP - EDGE;

    let top;
    let left;
    if (spaceBelow >= tipH) {
      top = rect.top + rect.height + GAP;
      left = centerX;
    } else if (spaceAbove >= tipH) {
      top = rect.top - GAP - tipH;
      left = centerX;
    } else if (spaceLeft >= tipW) {
      left = rect.left - GAP - tipW;
      top = centerY;
    } else if (spaceRight >= tipW) {
      left = rect.left + rect.width + GAP;
      top = centerY;
    } else {
      top = Math.max(EDGE, vh - EDGE - tipH);
      left = centerX;
    }

    setTipPos({ top, left });
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
        className="fixed inset-0 font-sans"
        style={{ zIndex: 100000 }}
        dir="rtl"
        aria-live="polite"
      >
        {/* Click-blocker: swallows interaction with the app underneath so the
            tour stays in control (and no menu action can fire). Clicking the
            dark area advances the tour. */}
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
            fontFamily: FONT_STACK,
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

          {/* Heading: "<process> - <feature>" (dash-separated, per request).
              fontFamily is set INLINE (not just via the .font-sans class) because
              the host wraps the app in a container and injects a
              `<container> h3 { font-family: … }` rule whose specificity (0,1,1)
              outranks our class (0,1,0); an inline style beats any selector, so
              the title renders in the same sans stack as the rest of the app
              instead of falling back to the browser's serif. */}
          <div className="mb-2 pl-6">
            <h3
              className="text-base md:text-lg font-extrabold leading-snug"
              style={{ fontFamily: FONT_STACK }}
            >
              <span className="text-blue-500">{step.process}</span>
              <span className="text-gray-300"> - </span>
              <span className="text-gray-900">{step.title}</span>
            </h3>
          </div>

          <p
            className="text-sm text-gray-600 leading-relaxed"
            style={{ fontFamily: FONT_STACK }}
          >
            {step.body}
          </p>

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
