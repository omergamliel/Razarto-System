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
//   control: { open, kpiType?, kpiTab?, demo? }  (ShiftCalendar) where `open` is
//     "kpi" | "switchflow" | "action" | "request" | "details-other" |
//     "details-own" | "accept" | null. The last four open a real creation modal
//     fed with read-only demo data so the tour can spotlight its actual buttons.
//   notif:     true              (open the notifications panel in demo mode)
//   notifIds:  ["demo-notif-…"]  (with notif) narrow the demo feed to exactly
//     these messages, in order — used to spotlight the one sidebar popup that a
//     given process sends to a given side (creator vs. targeted user). Omit to
//     show the whole catalog (the notifications overview + colour-legend steps).
// A step without control/notif implicitly closes every tour-opened surface.
//
// Tour shape: after orientation, the steps are grouped one request process at a
// time — for each process we show how it's CREATED, then the sidebar popup the
// OPENER sees, then the popup the TARGETED user sees, then how a THIRD user runs
// into it (in a KPI list — open requests never push a popup to bystanders). The
// demo notification ids come from NotificationSidebar.jsx's DEMO_MESSAGES.
//
// `demo: true` (on a KPI control, or implied for the notifications steps) tells
// the target surface to render make-believe example rows in different stages
// instead of the account's real (often empty) data — so the walkthrough always
// shows a populated list. It's read-only synthetic data; nothing is persisted.
const TOUR_STEPS = [
  // ======================================================================
  // התמצאות
  // ======================================================================
  {
    selector: "brand",
    process: "ברוכים הבאים",
    title: "מערכת Razarto",
    body: "המערכת לניהול משמרות והחלפות. הסיור עובר על כל תהליך בקשה בנפרד — איך יוצרים אותו, איזו הודעה מקבל מי שפתח אותו, איזו הודעה מקבל הצד השני, ומה רואה משתמש אחר במערכת. אפשר לצאת בכל שלב.",
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
    process: "התמצאות",
    title: "ניווט בלוח",
    body: "החליפו בין תצוגה חודשית לשבועית, ודלגו קדימה ואחורה בעזרת החיצים.",
  },
  {
    selector: "calendar-grid",
    process: "התמצאות",
    title: "לוח המשמרות",
    body: "כל משמרת צבועה לפי מצבה — הצבעים מוסברים במקרא שמעל הלוח. לחיצה על משמרת פותחת את חלון 'פעולות על המשמרת', שממנו מתחילים את רוב הבקשות.",
  },
  {
    selector: "kpi-band",
    process: "התמצאות",
    title: "לוח המחוונים",
    body: "ארבעה מונים חיים — בקשות החלפה, פערי כיסוי חלקי, היסטוריה, והמשמרות שלי — לצד הכפתור הסגול 'בקש החלפה'. לחיצה על מונה פותחת את הרשימה שמאחוריו. נשתמש בהם לאורך הסיור כדי לראות כל בקשה מכל הצדדים.",
  },

  // ======================================================================
  // תהליך 1 — בקשה כללית (החלפה מלאה הפתוחה לכולם)
  // ======================================================================
  {
    selector: "tour-action-request",
    process: "בקשה כללית",
    title: "יצירה — הכפתור שמתחיל הכל",
    body: "לחיצה על משמרת שלכם פותחת את חלון הפעולות, ובו כפתור אדום אחד — 'בקשת החלפה מלאה/חלקית' (מודגש עכשיו). הוא נקודת הכניסה לכל התהליכים. (הצגה בלבד — הכפתור מודגם, לא מופעל.)",
    control: { open: "action", demo: true },
    radius: 14,
  },
  {
    selector: "tour-request-type",
    process: "בקשה כללית",
    title: "יצירה — בחירת סוג",
    body: "בטופס שנפתח בוחרים 'משמרת מלאה' (העברת כל השעות). לבקשה כללית לא בוחרים יעד — היא נפתחת לכולם. ('החלפה חלקית' שמורה לכיסוי שעות בודדות, נגיע אליה בהמשך.)",
    control: { open: "request", demo: true },
    radius: 16,
  },
  {
    selector: "tour-request-submit",
    process: "בקשה כללית",
    title: "יצירה — שליחה",
    body: "כפתור 'בקש החלפה' פותח את הבקשה לכולם: היא מופיעה לכל המשתמשים ברשימת 'כל הבקשות'. 'ביטול' סוגר בלי לשלוח. (הצגה בלבד.)",
    control: { open: "request", demo: true },
    radius: 14,
  },
  {
    selector: "notif-panel",
    process: "בקשה כללית",
    title: "ההודעה שאתם (הפותח) מקבלים",
    body: "אחרי השליחה תקבלו למרכז ההודעות תזכורת אדומה — 'הבקשה שלך עדיין ממתינה' — כל עוד אף אחד לא לקח את המשמרת. הכפתור שבה מקפיץ ל'הבקשות שלי'.",
    notif: true,
    notifIds: ["demo-notif-pending"],
    radius: 16,
  },
  {
    selector: "kpi-modal",
    process: "בקשה כללית",
    title: "מה שמשתמש אחר רואה",
    body: "לכל שאר המשתמשים אין קופצת הודעה — הבקשה פשוט מופיעה בלשונית 'כל הבקשות'. תגית מסמנת את סוגה, ובקצה השורה שני כפתורים: 'קח את המשמרות' (ירוק) לקחת אותה, או 'הצע ראש בראש' (סגול) להציע לכם משמרת בתמורה. (דוגמאות להמחשה.)",
    control: { open: "kpi", kpiType: "swap_requests", kpiTab: "all", demo: true },
    radius: 20,
  },
  {
    selector: "notif-panel",
    process: "בקשה כללית",
    title: "כשמישהו לוקח — ההודעה שתקבלו",
    body: "ברגע שמשתמש אחר לוקח את המשמרת תקבלו הודעה ירוקה — 'המשמרת שלך כוסתה, אין צורך להגיע'. כך נסגר המעגל של הבקשה הכללית.",
    notif: true,
    notifIds: ["demo-notif-covered"],
    radius: 16,
  },

  // ======================================================================
  // תהליך 2 — ראש בראש (הצעת החלפה ישירה לאדם מסוים)
  // ======================================================================
  {
    selector: "tour-h2h",
    process: "ראש בראש",
    title: "יצירה — הכפתור שמתחיל",
    body: "כשפותחים משמרת של אדם אחר, הכפתור 'ראש בראש' (מודגש עכשיו) מציע לו החלפה ישירה — משמרת שלכם בתמורה לשלו. בשונה מבקשה כללית, ההצעה מופנית אליו בלבד. לחיצה עליו פותחת את מסך בחירת המשמרת. (הצגה בלבד.)",
    control: { open: "details-other", demo: true },
    radius: 14,
  },
  {
    selector: "tour-h2h-pick",
    process: "ראש בראש",
    title: "יצירה — איזו משמרת שלי לתת בתמורה",
    body: "במסך שנפתח מוצגת למעלה המשמרת שאתם רוצים לקחת, ומתחתיה רשימת המשמרות העתידיות שלכם. בוחרים אחת מהן שתינתן בתמורה (הראשונה מסומנת כאן לדוגמה). (הצגה בלבד.)",
    control: { open: "h2h-select", demo: true },
    radius: 16,
  },
  {
    selector: "tour-h2h-send",
    process: "ראש בראש",
    title: "יצירה — שליחה",
    body: "'שלח בקשת החלפה' מעביר את ההצעה לצד השני — המשמרת שבחרתם בתמורה למשמרת שלו. 'ביטול' סוגר בלי לשלוח. (הצגה בלבד.)",
    control: { open: "h2h-select", demo: true },
    radius: 14,
  },
  {
    selector: "notif-panel",
    process: "ראש בראש",
    title: "ההודעה שאתם (המציע) מקבלים",
    body: "כמו בכל בקשה שפתחתם, תקבלו תזכורת אדומה 'הבקשה שלך עדיין ממתינה' עד שהצד השני יגיב.",
    notif: true,
    notifIds: ["demo-notif-pending"],
    radius: 16,
  },
  {
    selector: "notif-panel",
    process: "ראש בראש",
    title: "ההודעה שהצד השני מקבל",
    body: "האדם שאליו הופנתה ההצעה מקבל הודעה אדומה — 'בקשת החלפה ראש בראש חדשה' עם שמכם. משתמש אחר במערכת לא רואה כלום, כי ההצעה ישירה. הכפתור שבהודעה מוביל אותו ל'בקשות אליי'.",
    notif: true,
    notifIds: ["demo-notif-h2h"],
    radius: 16,
  },
  {
    selector: "kpi-modal",
    process: "ראש בראש",
    title: "איך הצד השני מגיב",
    body: "בלשונית 'בקשות אליי' שלו מופיעה ההצעה: הכפתור הירוק 'קבל' מאשר את ההחלפה ההדדית, וכפתור ה-X האדום דוחה אותה. (דוגמה להמחשה.)",
    control: {
      open: "kpi",
      kpiType: "swap_requests",
      kpiTab: "incoming",
      demo: true,
    },
    radius: 20,
  },

  // ======================================================================
  // תהליך 3 — מתנה (לקיחת משמרת של אחר, בלי תמורה)
  // ======================================================================
  {
    selector: "tour-gift",
    process: "מתנה",
    title: "יצירה — הצעת מתנה",
    body: "במשמרת של אדם אחר שמתחילה היום, 'הצע לקחת את המשמרת במתנה' (מודגש עכשיו) מציע לקחת אותה ממנו — בלי שום תמורה. לחיצה עליו פותחת חלון אישור. (הצגה בלבד.)",
    control: { open: "details-other", demo: true },
    radius: 14,
  },
  {
    selector: "tour-gift-confirm",
    process: "מתנה",
    title: "יצירה — שליחה",
    body: "בחלון האישור 'כן, שלח הצעה' שולח את ההצעה לבעל המשמרת. אתם, המציעים, מקבלים אישור מיידי (טוסט) ולא הודעה במרכז ההודעות. (הצגה בלבד.)",
    control: { open: "details-other", giftConfirm: true, demo: true },
    radius: 14,
  },
  {
    selector: "notif-panel",
    process: "מתנה",
    title: "ההודעה שבעל המשמרת מקבל",
    body: "בעל המשמרת מקבל הודעה ורודה — 'הוצעה לך מתנה 🎁' — עם שם המציע. רק הוא מקבל אותה; שאר המשתמשים לא רואים דבר. הוא צריך רק לאשר כדי להשתחרר מהמשמרת.",
    notif: true,
    notifIds: ["demo-notif-gift"],
    radius: 16,
  },
  {
    selector: "kpi-modal",
    process: "מתנה",
    title: "איך בעל המשמרת מאשר",
    body: "בלשונית 'בקשות אליי' שלו יופיע הכפתור הוורוד 'קבל מתנה' — אישורו משחרר אותו מהמשמרת ומעביר אותה אליכם. כפתור ה-X האדום דוחה את ההצעה. (דוגמה להמחשה.)",
    control: {
      open: "kpi",
      kpiType: "swap_requests",
      kpiTab: "incoming",
      demo: true,
    },
    radius: 20,
  },

  // ======================================================================
  // תהליך 4 — כיסוי חלקי (בקשה לכסות רק חלק משעות המשמרת)
  // ======================================================================
  {
    selector: "tour-request-type",
    process: "כיסוי חלקי",
    title: "יצירה — בחירת 'החלפה חלקית'",
    body: "מאותו טופס בקשה (הנפתח ממשמרת שלכם), בוחרים הפעם 'החלפה חלקית' במקום 'משמרת מלאה'. כך תבקשו כיסוי לחלק מהשעות בלבד. (הצגה בלבד.)",
    control: { open: "request", requestType: "partial", demo: true },
    radius: 16,
  },
  {
    selector: "tour-partial-hours",
    process: "כיסוי חלקי",
    title: "יצירה — בחירת חלון השעות",
    body: "בבורר שנפתח מסמנים את חלון השעות שתרצו שיכוסה — בגרירת הסליידר או בהזנה ידנית. כל שעה שלא סימנתם נשארת עליכם. כך נוצר 'פער' שאחרים יכולים למלא. (הצגה בלבד.)",
    control: { open: "request", requestType: "partial", demo: true },
    radius: 16,
  },
  {
    selector: "tour-request-submit",
    process: "כיסוי חלקי",
    title: "יצירה — שליחה",
    body: "'בקש החלפה' פותח את הפער לכולם: הוא מופיע לכל המשתמשים ברשימת 'כל הפערים', ומי שירצה יוכל לכסות חלק מהשעות או את כולן. 'ביטול' סוגר בלי לשלוח. (הצגה בלבד.)",
    control: { open: "request", requestType: "partial", demo: true },
    radius: 14,
  },
  {
    selector: "notif-panel",
    process: "כיסוי חלקי",
    title: "ההודעה שאתם (הפותח) מקבלים",
    body: "כל עוד הפער פתוח תקבלו תזכורת אדומה — 'בקשת הכיסוי החלקי שלך עדיין ממתינה למענה'. הכפתור שבה מקפיץ ל'הפערים שלי'.",
    notif: true,
    notifIds: ["demo-notif-partial-pending"],
    radius: 16,
  },
  {
    selector: "kpi-modal",
    process: "כיסוי חלקי",
    title: "מה שמשתמש אחר רואה",
    body: "הפער מופיע לכולם בלשונית 'כל הפערים'. הפס הצבעוני בכל שורה מראה מה כבר מכוסה (בשמות המכסים) ומה עדיין פנוי, והכפתור 'אחליף' פותח את מסך בחירת השעות. (דוגמאות להמחשה.)",
    control: { open: "kpi", kpiType: "partial_gaps", kpiTab: "all", demo: true },
    radius: 20,
  },
  {
    selector: "tour-cover-confirm",
    process: "כיסוי חלקי",
    title: "איך משתמש אחר מכסה",
    body: "במסך שנפתח ב'אחליף' הוא מסמן את חלון השעות שיכסה (מה שכבר מכוסה מוצג בפס) ולוחץ 'אשר כיסוי'. גם כאן המכסה מקבל אישור מיידי (טוסט), לא הודעה במרכז ההודעות. (הצגה בלבד.)",
    control: { open: "accept", demo: true },
    radius: 14,
  },
  {
    selector: "notif-panel",
    process: "כיסוי חלקי",
    title: "ההודעות שבעל המשמרת מקבל",
    body: "כשמישהו מציע לכסות שעות תקבלו הודעה צהובה — 'הוצע כיסוי למשמרת שלך'. כשכל השעות שביקשתם כוסו, ההודעה הופכת לירוקה — 'הבקשה החלקית שלך קיבלה מענה מלא'. (שתי דוגמאות ברצף.)",
    notif: true,
    notifIds: ["demo-notif-partial-offer", "demo-notif-partial-covered"],
    radius: 16,
  },
  {
    selector: "kpi-modal",
    process: "כיסוי חלקי",
    title: "מעקב — הפערים שלי ומה שאני מכסה",
    body: "בלשונית 'הפערים שלי' מרוכזות בקשות הכיסוי שפתחתם (כפתור ה-X מבטל בקשה), ובלשונית 'מה שאני מכסה' — הפערים שאתם התחייבתם לכסות אצל אחרים. (דוגמאות להמחשה.)",
    control: { open: "kpi", kpiType: "partial_gaps", kpiTab: "mine", demo: true },
    radius: 20,
  },

  // ======================================================================
  // תהליך 5 — החלפה מרובת-משמרות (הפס התחתון)
  // ======================================================================
  {
    selector: "kpi-switch_request",
    process: "החלפה מרובה",
    title: "יצירה — הכפתור הסגול",
    body: "הכפתור הסגול 'בקש החלפה' מתחיל מסלול נוח לבחירת כמה משמרות יחד, דרך פס בתחתית המסך. נפתח אותו עכשיו.",
  },
  {
    selector: "switch-band",
    process: "החלפה מרובה",
    title: "שלב 1 — בחירת המשמרות שלי",
    body: "בפס התחתון מסמנים בלוח את המשמרת/ות שלכם שתרצו להעביר (המונה מתעדכן) ולוחצים 'המשך'. 'ביטול' יוצא מהתהליך. (תצוגה בלבד — לא נשלחת בקשה.)",
    control: { open: "switchflow" },
    radius: 10,
  },
  {
    selector: "switch-band",
    process: "החלפה מרובה",
    title: "שלב 2 — יעד או בקשה כללית",
    body: "בשלב היעד שתי דרכים, בדיוק כמו קודם: בחירת משמרת של אדם אחר ואז 'אישור ושליחה' — הצעת ראש-בראש ישירה מולו; או 'שלח כבקשה כללית' — פתיחת הבקשה לכולם. ההודעות שכל צד יקבל זהות לתהליכים שראינו.",
    control: { open: "switchflow" },
    radius: 10,
  },

  // ======================================================================
  // מרכז ההודעות — סיכום
  // ======================================================================
  {
    selector: "notif-button",
    process: "מרכז ההודעות",
    title: "הכפתור",
    body: "הכפתור הצף בפינה הימנית-תחתונה פותח את מרכז ההודעות. נקודה כחולה עליו מסמנת שיש הודעה חדשה שטרם נצפתה.",
    radius: 999,
  },
  {
    selector: "notif-panel",
    process: "מרכז ההודעות",
    title: "כל ההודעות במקום אחד",
    body: "כל ההודעות מכל התהליכים מצטברות כאן. בכל הודעה יש כפתור שקופץ ישר לרשימה הרלוונטית ('בקשות אליי' או 'הבקשות שלי'), אפשר להסיר הודעה בודדת ב-X או 'נקה הכל' מהכותרת. (ההודעות כאן לדוגמה.)",
    notif: true,
    radius: 16,
  },
  {
    selector: "notif-panel",
    process: "מרכז ההודעות",
    title: "מקרא הצבעים",
    body: "אדום — בקשת ראש בראש שהגיעה אליכם, או תזכורת שבקשה שפתחתם עדיין ממתינה. ורוד — הוצעה לכם מתנה. צהוב — הוצע כיסוי לפער במשמרת שלכם. ירוק — המשמרת/השעות שלכם כוסו. אפור — סיכום, למשל בקשה חלקית שהסתיימה בלי מענה.",
    notif: true,
    radius: 16,
  },

  // ======================================================================
  // היסטוריה וקהילה
  // ======================================================================
  {
    selector: "kpi-modal",
    process: "היסטוריה",
    title: "החלפות שהושלמו",
    body: "כל ההחלפות שנסגרו והבקשות שהושלמו, מרוכזות כאן למעקב ולתיעוד. (דוגמאות להמחשה.)",
    control: { open: "kpi", kpiType: "approved", kpiTab: "all", demo: true },
    radius: 20,
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
      // empty) real feed. `notifIds`, when present, narrows the demo feed to the
      // one message the step is explaining (a given process + perspective);
      // without it the panel shows the whole catalog (overview / colour legend).
      detail: {
        open: !!step?.notif,
        demo: !!step?.notif,
        ids: step?.notifIds || null,
      },
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
      const bringIntoView = () =>
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      bringIntoView();
      const t0 = performance.now();
      let lastScroll = 0;
      const loop = () => {
        if (cancelled) return;
        measure();
        // The first scroll can fire before the target's surface has settled its
        // layout — a modal/menu that scrolls internally, or an entrance
        // animation (scale / slide-up) that shifts the target after mount — which
        // leaves it parked off-screen with the spotlight pointing below the fold.
        // Re-issue the scroll while the target's centre is still outside the
        // viewport so it always ends up centred once layout settles.
        const now = performance.now();
        const r = el.getBoundingClientRect();
        const center = r.top + r.height / 2;
        const outOfView = center < 0 || center > window.innerHeight;
        if (outOfView && now - lastScroll > 200) {
          bringIntoView();
          lastScroll = now;
        }
        if (now - t0 < 1200) rafId = requestAnimationFrame(loop);
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
