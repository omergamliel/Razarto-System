# קומפוננטות Sidebar (`src/components/sidebar`)

## `messageStore.js`
**מטרה:** Pub/sub store מנותק (decoupled) לניהול רשימת הודעות/פופאפים עבור `NotificationSidebar.jsx`. אינו תלוי ב-React — מודול JS טהור עם מצב מודול-גלובלי (`messages`) ורשימת מאזינים (`Set`).

**API:**
- `addMessage({ type, title, body, actionLabel, actionTarget })` – מוסיף הודעה חדשה בראש הרשימה (`id`/`created_date` נוצרים אוטומטית) ומפעיל את כל המאזינים. מחזיר את ה-`id` שנוצר (שימושי אם קורא רוצה להסיר את ההודעה מאוחר יותר, למשל בסיום Mutation).
- `getMessages()` – מחזיר את המצב הנוכחי (snapshot, לא reactive).
- `subscribe(listener)` – נרשם לעדכונים; מחזיר פונקציית ניקוי (`unsubscribe`). `NotificationSidebar.jsx` היחיד שקורא לזה כרגע.
- `removeMessage(id)` / `clearAll()` – הסרת הודעה בודדת / ריקון הרשימה.
- `dispatchAction(actionTarget)` – מפעיל `CustomEvent('razarto:sidebar-action', { detail: { target: actionTarget } })` על `window`. נקרא כשלוחצים על כפתור הפעולה בתוך הודעה בסיידבר (`msg.actionLabel`/`msg.actionTarget`).

**עקרון עיצוב מרכזי:** ניתוק חד-כיווני מכוון. אף קומפוננטה לא מייבאת את `NotificationSidebar.jsx` כדי "לפתוח" אותה ישירות — קוד שרוצה להציג הודעה קורא ל-`addMessage()` בלבד; קוד שרוצה להגיב ללחיצת "פעולה" בהודעה מאזין ל-`razarto:sidebar-action` על `window` (המאזין היחיד היום: `ShiftCalendar.jsx`, ראו למטה).

---

## `notificationEvents.js`
**מטרה:** לוגיקה טהורה (ללא I/O) שממירה snapshot נוכחי של `Shift`/`SwapRequest`/`ShiftCoverage`/`AuthorizedPerson` לרשימת "אירועים" רלוונטיים למשתמש נתון.

**`computeNotificationEvents({ me, shifts, swapRequests, coverages, allUsers })`** — מחזירה מערך `{ fingerprint, type, title, body, actionLabel, actionTarget }`. אין כאן שום תלות ב"מי ביצע את הפעולה עכשיו" — הזיהוי נעשה כולו מהמצב הנוכחי של הנתונים, ולכן אין צורך ב-Websocket/Push: כל דפדפן שמריץ סריקה נגד הנתונים העדכניים (בטעינה, או בכל `invalidateQueries` על `shifts`/`swap-requests`/`coverages`) מזהה בעצמו את מה שרלוונטי אליו.

חמישה סוגי אירועים (כל אחד עם `fingerprint` יציב מבוסס מזהה+מצב, כדי שלא יופיע פעמיים):
| # | תנאי (יחסית ל-`me.serial_id`) | טביעת אצבע | צבע | יעד לחיצה |
|---|---|---|---|---|
| 1 | בקשת `Head2Head` פתוחה שבה אחת מהמשמרות שלי מופיעה ב-`offered_shift_ids` | `h2h-incoming:{id}` | אדום (`swap_requested`) | `kpi:swap_requests:incoming` |
| 2 | שורת `ShiftCoverage` (`Pending`/`Approved`) על משמרת שלי ממישהו אחר | `coverage-new:{id}` | ירוק אם הבקשה כבר `Closed`, אחרת צהוב | `kpi:partial_gaps:mine` (בקשת Partial) / `kpi:swap_requests:mine` (Full) |
| 3 | שורת `ShiftCoverage` שבוטלה (`Cancelled`) על משמרת שלי | `coverage-cancelled:{id}` | צהוב | כנ"ל |
| 4 | `SwapRequest` שלי שנסגר (`Closed`/`Completed`) | `sr-closed:{id}` | ירוק | `kpi:approved` |
| 5 | `SwapRequest` של מישהו אחר שנסגר, ואני כיסיתי חלק ממנו | `sr-closed-covered-by-me:{id}` | ירוק | `kpi:approved` |

**מגבלה ידועה (בכוונה לא מטופלת):** אין אירוע "הבקשה שלך נדחתה/בוטלה" — `cancelSwapMutation`/`cancelSwapRequestMutation` הוא אותו נתיב קוד בין "ביטלתי את הבקשה שלי" לבין "מישהו דחה בקשת Head2Head שנכנסה אליו" (כפתור הדחייה ב-`KPIListModal.jsx` קורא לאותו `onCancelRequest`), ואין שדה שמתעד מי ביטל. הוספת שיוך נכון תדרוש שדה חדש כמו `cancelled_by_user_id`.

**בכוונה לא כלול:** פופאפ broadcast על "נפתחה בקשה חדשה" לכל משתמש — רק אירועים ממוקדים אישית (כמו הצעת-נגד ראש-בראש שמגיעה לאדם ספציפי).

---

## `useNotificationScanner.js` (`src/hooks/`)
**מטרה:** ה"דבק" בין `notificationEvents.js` ל-`messageStore.js`. מריץ `useQuery` על אותם מפתחות בדיוק שמשתמשת בהם `ShiftCalendar.jsx` (`["current-user"]`, `["all-users"]`, `["shifts"]`, `["swap-requests"]`, `["coverages"]`) כך שאין קריאת רשת כפולה — רק צרכן נוסף לאותו Cache. ב-`useEffect` (תלוי בארבעת מערכי הנתונים): מריץ `computeNotificationEvents`, משווה מול סט "כבר נצפה" השמור ב-`localStorage` (מפתח `razarto_notif_seen_<serial_id>`, לפי מוסכמת ה-`base44_*` הקיימת ב-`src/lib/app-params.js`), וקורא ל-`addMessage()` רק על טביעות אצבע חדשות. מוזרק לתוך `NotificationSidebar()` (קריאת `useNotificationScanner()` בשורה הראשונה של הקומפוננטה) — כך שכל הפיצ'ר נשאר מוכל בתוך `src/components/sidebar/` + `src/hooks/`, בלי ש-`Home.jsx`/`ShiftCalendar.jsx` צריכים "לדעת" עליו.

**חוזה מציאותי (אין Push):** האפליקציה הזו לקוח-בלבד מול Base44, בלי Websocket/SSE/Polling. משתמש B יראה פופאפ על פעולה של משתמש A רק בפעם הבאה שהדפדפן של B מביא נתונים טריים (טעינה מחדש, או Mount). בפועל, בתוך אותו טאב, כמעט כל Mutation קוראת ל-`invalidateQueries` על אחד מהמפתחות שהסורק גם הוא מאזין להם — כך שעדכונים באותו טאב מרגישים כמעט-חיים כתופעת לוואי, גם בלי שום תשתית realtime חדשה.

---

## `NotificationSidebar.jsx`
**מטרה:** פאנל צד קבוע (RTL, נפתח מימין) שמציג את רשימת ההודעות מ-`messageStore.js`. מורכב תמיד ב-`Home.jsx` (גלובלי, לא תלוי-Route).

**קומפוננטות/לוגיקה:**
- `NotificationSidebar()` – קורא ל-`useNotificationScanner()` בשורה הראשונה (מציף את `messageStore.js` בהודעות). כפתור צף עגול (`MessageSquare`, פינה ימנית-תחתונה, `z-40`) שפותח/סוגר פאנל `motion.aside` מונפש (Framer Motion, `spring`), עם Backdrop למובייל בלבד. נעילת גלילה של הרקע כשפתוח (`useScrollLock`).
- `TYPE_STYLES` – מיפוי `type → { label, bg, border, badge, text, icon }`, שישה סוגים: `swap_requested` (אדום), `partial` (צהוב), `covered` (ירוק), `mine` (כחול), `holiday` (סגול), `info` (אפור, ברירת מחדל). **הצבעים תואמים בכוונה לצבעי סטטוס המשמרת ב-`ShiftCell.jsx`** כדי שהודעה על משמרת תיראה עקבית עם איך שהמשמרת עצמה מסומנת בלוח.
- `getStyle(type)` – בורר סגנון עם נפילה ל-`info` אם הסוג לא מוכר.
- כל כרטיס הודעה: אייקון+badge צבעוני, תווית סוג, כותרת/גוף אופציונליים, כפתור הסרה (`removeMessage`), וכפתור פעולה אופציונלי (`msg.actionLabel`) שקורא ל-`dispatchAction` וסוגר את הפאנל.
- מצב ריק ("אין הודעות כרגע") מוצג כש-`getMessages()` מחזיר מערך ריק — המצב הנוכחי בפועל, ראו הערה ב-`messageStore.js`.

**קונטקסט שימוש:** `Home.jsx` מרכיב `<NotificationSidebar />` לצד `<ShiftCalendar />`, ללא Props — הוא קורא ל-`messageStore.js` ו-`useNotificationScanner()` ישירות.

**חיבור ל-KPIListModal (הצד השני של `dispatchAction`):** `ShiftCalendar.jsx` מאזין ל-`razarto:sidebar-action` (`useEffect` על `window.addEventListener`), מפרש `detail.target` בתבנית `"kpi:<type>"` או `"kpi:<type>:<tab>"`, ומפעיל `setKpiListType`/`setKpiInitialTab`/`setShowKPIListModal(true)`. `kpiOpenSeq` (מונה שעולה בכל פתיחה, גם דרך כרטיסי ה-KPI וגם דרך פופאפ) משולב במפתח `key` של `<KPIListModal>` כדי להבטיח Remount נקי בכל פתיחה — אחרת פתיחה חוזרת על אותו `type` עם טאב התחלתי שונה לא הייתה מתעדכנת. `KPIListModal.jsx` מקבל את `initialTab` כ-Prop וקובע לפיו את מצב ה-`useState` ההתחלתי של `swapTab`/`partialGapsTab`.
