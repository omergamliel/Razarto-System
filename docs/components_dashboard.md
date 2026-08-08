# קומפוננטות Dashboard (`src/components/dashboard`)

## `KPIHeader.jsx`
**מטרה:** פס KPI ראשי עם מדדים (בקשות מלאות/חלקיות/היסטוריה/משמרות עתידיות שלי) **וכרטיס פעולה חמישי** שמפעיל את תהליך "בקשת החלפה מרובה".

**קומפוננטות/פונקציות:**
- `KPIHeader({ currentUser, onKPIClick, onStartSwitchFlow })` – מריץ Query-ים לספירת כל מדד (ישירות מול `SwapRequest`/`ShiftCoverage`/`Shift`). ה-Query של `SwapRequest` משתמש במפתח `['swap-requests']` — **זהה** לזה שמשתמשת בו `ShiftCalendar`, כך שכל `invalidateQueries(['swap-requests'])` בכל מקום באפליקציה מרענן גם את ה-KPI-ים כאן בלי המתנה ל-remount. הכרטיס החמישי (`id: 'switch_request'`, `isAction: true`, אייקון `ArrowLeftRight` סגול) אינו מציג ספירה — לחיצה עליו קוראת ל-`onStartSwitchFlow()` (מוגדר ב-`ShiftCalendar`) במקום ל-`onKPIClick`. הגריד הוא `grid-cols-2 sm:grid-cols-3 md:grid-cols-5` כדי להתאים לחמישה כרטיסים.
- ספירת "בקשות להחלפה מלאה" (הכרטיס האדום) כוללת גם בקשות מסוג `Head2Head` ו-`General`, לא רק `Full` — כולן בסופו של דבר בקשות למשמרת שלמה.

---

## `KPIListModal.jsx`
**מטרה:** מודאל המציג רשימה מפורטת של פריטים לפי סוג KPI שנבחר (בקשות פתוחות/חלקיות/היסטוריה/המשמרות שלי). מודע למבנה המערכים (`shift_ids[]`/`offered_shift_ids[]`) של `SwapRequest` ולכל ארבעת סוגי הבקשה (`Full`/`Partial`/`Head2Head`/`General`).

**פונקציות עיקריות:**
- `enrichRequestsWithShiftInfo(requests)` – מעשיר בקשה בכל המשמרות שהיא מכילה (`original_shifts`, `shift_count`), במשמרות המוצעות בתמורה (`offered_shifts`, כולל שם הבעלים), ובזיהוי מי קיבל בקשת Head2Head סגורה (`accepted_by_names`).
- `enrichShiftsWithUserInfo(shifts)` – מעשיר משמרת (בתצוגת "המשמרות שלי") בסטטוס תצוגה (`covered`/`requested`/`partial`/`regular`) לפי בקשה פעילה שמכילה אותה.
- `computeMissingSegments(windowStart, windowEnd, coverageSegments)` – חישוב פערי כיסוי בטווח נתון.
- `getStartDateTime(item)` / `getLatestActivityDate(item)` / `getDisplayDay(dateStr)` – עזרי זמן ותצוגה.
- `isOpenStatus(status)` – בדיקה אם סטטוס נחשב "פתוח" (`Open`/`Partially_Covered`).
- `handleAddToCalendar(item)` – פתיחת קישור Google Calendar עם פרטי המשמרת.
- `handleRequestSwap(item)` / `handleReshareWhatsapp(item)` / `getApprovalUrl(item)` – פתיחת בקשת החלפה חדשה / שיתוף חוזר בוואטסאפ / בניית קישור אישור.
- `getTitleAndColor()` – קביעה דינמית של כותרת המודאל וצבעיו לפי סוג ה-KPI שנבחר.

**כפתורי פעולה לפי סוג הפריט (Props מ-`ShiftCalendar`: `onOfferCover`, `onRequestSwap`, `onCancelRequest`, `onCancelCoverage`, `onAcceptHeadToHead`, `onAcceptGeneralRequest`, `onStartCounterOffer`):**
- בקשה רגילה (Full/Partial) שלא שלי → "אחליף" (`onOfferCover`), ממוקם בשורה העליונה של הפריט (יחד עם התאריך והתגית), לא בעמודת הפעולות התחתונה. מועבר אליו תמיד `item.original_shift` (רשומת `Shift` אמיתית, לא ה-`SwapRequest` המועשר) — כך שהוא פותח את אותו `AcceptSwapModal` שנפתח בלחיצה על תא המשמרת בלוח עצמו (דרך `normalizeShiftContext`). לא מוצג אם המשתמש הנוכחי כבר מופיע ב-`item.covering_user_ids` (כלומר כבר מכסה חלק מהפער).
- בקשת Head2Head נכנסת (אחת מהמשמרות המוצעות היא שלי) → "קבל" (`onAcceptHeadToHead`) או דחייה (`onCancelRequest`).
- בקשה כללית (`General`) פתוחה של מישהו אחר → "קח את המשמרות" (`onAcceptGeneralRequest`, לקיחה בלי תמורה) או "הצע ראש בראש" (`onStartCounterOffer`, פותח `switchFlow` במצב הצעת-נגד).
- בקשה/פער חלקי שלי → ביטול (`onCancelRequest`); אם אני רק מכסה חלק ממנה → ביטול ההשתתפות שלי בלבד (`onCancelCoverage`).
- שלושה טאבים בתצוגת "בקשות להחלפה": כל הבקשות הפתוחות / הבקשות שלי / בקשות אליי (Head2Head שממוקדות אליי). תצוגת "פערים חלקיים" כוללת **שלושה** טאבים: כל הפערים הפתוחים / "הפערים שלי" (בעלות בלבד — `item.original_user_id === currentUser.serial_id`) / "משמרות שאני מכסה" (`item.covering_user_ids` כולל אותי) — שני הטאבים האחרונים מוציאים זה את זה במפורש כדי שמשמרת שהמשתמש רק מכסה בה חלק לא תופיע גם תחת "הפערים שלי".
- פריטי "פערים חלקיים" (`type === "partial_gaps"`) מציגים גם סליידר כיסוי חזותי (`PartialGapCoverageTrack`, עוטף מחדש את `PartialShiftTrack` הקיים מ-`components/calendar`) לפני רשימת הטקסט "מי מכסה עד כה" — אותו רכיב סליידר/מקרא בשימוש כבר בתצוגת "היסטוריה" (`SwapTransition.jsx`, `type === "approved"`), כעת גם בפריט חי לפני שהוא נסגר.
- כל ארבע נקודות הקריאה ל-`onCancelRequest` (ביטול "שלי", ביטול פער חלקי, ביטול בקשה כללית שלי, דחיית Head2Head נכנסת) לא קוראות לו ישירות מה-`onClick` — הן פותחות קודם דיאלוג אישור מקומי (`pendingCancelAction` state + `Dialog` מ-`@/components/ui/dialog`, לא toast) עם טקסט "האם אתה בטוח?" וכפתורי אישור/ביטול; רק אישור בפועל קורא ל-`onCancelRequest(item)`.

---

## `HallOfFameModal.jsx`
**מטרה:** הצגת "היכל התהילה" למובילי החלפות/כיסויים.

**פונקציות:**
- `getRankBadge(rank)` – בחירת תגית/צבע לפי דירוג.

---

## `HelpSupportModal.jsx`
**מטרה:** מודאל תמיכה/שאלות נפוצות (FAQ) עם אפשרות פתיחה/סגירה לכל שאלה.

**פונקציות:**
- `toggleExpand(index)` – פתיחה/סגירה של שאלה לפי אינדקס.
