# זרימת נתונים ותהליכים (Data Flow)

## 1) אתחול אפליקציה
- `main.jsx` טוען את `App` ומחבר CSS גלובלי.
- `App.jsx` עוטף את האפליקציה ב-`AuthProvider` וב-`QueryClientProvider`.
- הראוטינג נבנה דינמית מתוך `pages.config.js`.

## 2) תהליך אימות משתמש
1. `AuthProvider` מופעל בעת טעינת האפליקציה (`checkAppState`).
2. מתבצעת קריאה ל־`/api/apps/public` לקבלת Public Settings.
3. אם אין Token → המשתמש מוגדר כלא מאומת.
4. אם יש Token → קריאה ל־`base44.auth.me()` לקבלת פרטי המשתמש (`checkUserAuth`).
5. שגיאות רלוונטיות:
   - `auth_required` → ניווט אוטומטי ל-Login (`navigateToLogin`).
   - `user_not_registered` → הצגת `UserNotRegisteredError`.

## 3) טעינת לוח משמרות
- לאחר אימות, `ShiftCalendar` בודק שהמשתמש קיים בטבלת `AuthorizedPerson` (לפי אימייל, לא רגיש לרישיות), ואם לא חובר עדיין לחשבון מציג `OnboardingModal`.
- לאחר מכן מפעיל מספר Query-ים:
  - `Shift.list()` – רשימת משמרות.
  - `SwapRequest.list()` – בקשות החלפה.
  - `ShiftCoverage.list()` – כיסויים/אישורים.
  - `AuthorizedPerson.list()` – כלל המשתמשים המורשים.
- הנתונים מנורמלים באמצעות `normalizeShiftContext` (ב־`whatsappTemplates.jsx`) לפני שהם מוצגים ב-`CalendarGrid`.

## 4) יצירת בקשת החלפה
1. המשתמש פותח `SwapRequestModal` (מתוך `ShiftActionModal` על משמרת שלו).
2. בוחר Full/Partial ומגדיר חלון זמן (סליידר או קלט ידני).
3. `handleSubmit` בונה Payload עם תאריכים ושעות.
4. `ShiftCalendar` שולח את הבקשה דרך `base44.entities.SwapRequest.create()` ומעדכן את סטטוס המשמרת ל-`Swap_Requested`.
5. ה-Query-ים מתרעננים (`invalidateQueries`) ומוצג `SwapSuccessModal`.

## 5) הצעת/אישור כיסוי לבקשה קיימת
1. משתמש אחר פותח את `ShiftDetailsModal` ולוחץ "אני רוצה לעזור", מה שפותח את `AcceptSwapModal`.
2. `AcceptSwapModal` בונה חלון כיסוי (מלא או מקטע חלקי) בעזרת `computeCoverageSummary`/`calculateMissingSegments`.
3. הנתונים נשלחים ל-Backend דרך `base44.entities.ShiftCoverage.create()`.
4. לפי מספר הפערים שנותרו, המערכת מעדכנת את סטטוס הבקשה/המשמרת ל-`Closed`/`Covered` (כיסוי מלא) או `Partially_Covered` (עדיין חסר).

## 5ב) החלפה "ראש בראש" (מ-`ShiftDetailsModal`, יעד יחיד)
1. מתוך `ShiftDetailsModal` ניתן לבחור "ראש בראש", שפותח את `HeadToHeadSelectorModal` – בחירת אחת מהמשמרות העתידיות של המשתמש להציע בתמורה למשמרת המטרה.
2. `createH2HRequestMutation` יוצר `SwapRequest` אמיתי (`request_type: 'Head2Head'`, `shift_ids: [המשמרת שנבחרה]`, `offered_shift_ids: [משמרת המטרה]`) ומעדכן את המשמרת שנבחרה לסטטוס `Swap_Requested`.
3. בהצלחה נסגר המודאל ונפתח דיאלוג הצלחה ממורכז (state מקומי, לא Toast) עם אפשרות נוספת לשלוח הודעת WhatsApp עם קישור אישור (`buildHeadToHeadDeepLink`).
4. בעל המשמרת המוצעת רואה את הבקשה בתור "בקשה אליי" ב-`KPIListModal` (טאב "בקשות להחלפה" → "בקשות אליי"), ויכול ללחוץ "קבל" (סעיף 5ד) או לדחות.
5. אם נשלח קישור ה-WhatsApp: נפתח `HeadToHeadApprovalModal` (דרך פרמטרים ב-URL שנקראים ב-`ShiftCalendar`) — כפתור "אשר" שם מפעיל את הנתיב הישן `headToHeadSwapMutation` (החלפת שדות תצוגה בין שתי המשמרות ישירות, לא דרך `SwapRequest`).

## 5ג) "בקשת החלפה מרובה" (Switch Flow, מ-KPI, כמה משמרות/כמה יעדים)
1. המשתמש לוחץ על כרטיס הפעולה הסגול "התחל בקשת החלפה" ב-`KPIHeader` → `ShiftCalendar` פותח `switchFlow` (`{ step: 'own', ownShiftIds: [], targetShiftIds: [] }`) ומזניק את התאריך הנוכחי לחודש הראשון שבו יש למשתמש משמרת עתידית זכאה, כדי שלא יראה לוח מוחשך לגמרי.
2. **שלב 'own':** לחיצה על תאים בלוח (`handleCellClick`, כשה-`switchFlow` פעיל) מוסיפה/מסירה משמרות עתידיות **שלי** בסטטוס רגיל מ-`ownShiftIds`. `SwitchFlowBand` מציג מונה ואת כפתור "המשך".
3. **שלב 'target':** אותה לחיצה, אך כעת רק על משמרות עתידיות של **אחרים** בסטטוס רגיל, לתוך `targetShiftIds`. אם כבר נבחרה משמרת של אדם מסוים ומנסים לבחור משמרת של אדם אחר — נחסם, עם אזהרה אדומה ל-3 שניות (בקשת ראש-בראש אחת יכולה ליעד רק אדם אחד).
4. מ-`SwitchFlowBand` יש שתי דרכי סיום:
   - **"אישור ושליחה"** (`switchRequestMutation`) – יוצר `SwapRequest` מסוג `Head2Head` אחד לכל בעלים ייחודי בין המשמרות שנבחרו כיעד (בפועל, כל היעדים כבר מוגבלים לאדם אחד משלב 3), עם `shift_ids` המשותף של כל המשמרות שהמשתמש הציע ו-`offered_shift_ids` של משמרות אותו אדם. מעדכן את משמרות המבקש לסטטוס `Swap_Requested`.
   - **"שלח כבקשה כללית"** (`generalSwitchRequestMutation`, "skip" של שלב היעד — לא נדרש לבחור יעד כלל) – יוצר `SwapRequest` אחד מסוג `General`, `offered_shift_ids: []`, פתוח לכולם.
5. "ביטול" בכל שלב סוגר את `switchFlow` בלי לשמור שינוי.

## 5ד) קבלת בקשה קיימת (Head2Head / General) מ-`KPIListModal`
- **Head2Head נכנסת אליי** (אחת מ-`offered_shift_ids` היא שלי): "קבל" מפעיל `acceptHeadToHeadRequestMutation` — מחליף בעלות (`original_user_id`) דו-כיוונית בין `shift_ids` (למקבל) ל-`offered_shift_ids` (למבקש המקורי), סוגר את הבקשה (`Closed`), ומבטל כל בקשה אחרת שהתייחסה לאחת מהמשמרות שהוחלפו.
- **General פתוחה של מישהו אחר:** "קח את המשמרות" מפעיל `acceptGeneralRequestMutation` — מעביר את כל `shift_ids` לבעלות המקבל בלי תמורה, סוגר את הבקשה, ומבטל בקשות אחרות שהתייחסו לאותן משמרות. "הצע ראש בראש" מפעיל `handleStartCounterOffer`, שפותח `switchFlow` במצב הצעת-נגד עם `targetShiftIds` ממולאים מראש ממשמרות הבקשה המקורית — מכאן זה ממשיך כמו סעיף 5ג, שלב 'own' בלבד, ומסתיים דרך `switchRequestMutation` הרגיל.

## 5ה) ניקוי עצלני (Lazy cleanup)
בכל טעינה, `ShiftCalendar` מוחק בקשות `Open`/`Partially_Covered` שתאריכן עבר, ומחזיר לסטטוס `Active` משמרות שנשארו "יתומות" (בסטטוס `Swap_Requested`/`Partially_Covered` בלי בקשה חיה מאחוריהן, למשל בגלל ביטול/מחיקה ידנית מחוץ לזרימה הרגילה).

## 6) תבניות שיתוף (WhatsApp)
- `buildSwapTemplate` ו-`buildHeadToHeadTemplate` בונים הודעה + Deep Link.
- `buildShiftDeepLink`/`buildHeadToHeadDeepLink` מייצרים URL שמחזיר את המשתמש לאפליקציה במצב "פתיחת משמרת/אישור ספציפיים" (נקרא דרך פרמטרים ב-Query String, ולא Route נפרד).

## 7) לוגיקה של KPI
- `KPIHeader` ו-`KPIListModal` שולחים Query-ים עצמאיים משלהם אל `SwapRequest`/`ShiftCoverage`/`Shift` כדי להציג מדדים (בקשות פתוחות/חלקיות, היסטוריה, משמרות עתידיות של המשתמש).

## 7ב) חלוקת משמרות הוגנת (מנהל/Manager, מ-`AdminSettingsModal`)
1. מנהל פותח את טאב "חלוקת משמרות" ובוחר טווח תאריכים (התחלה/סיום).
2. "הפעל חלוקה הוגנת" (`runDistributionMutation`) מסנן מתוך `AuthorizedPerson` את מי שההרשאה שלו `RR` או `Manager`, קורא ל-`distributeShifts()` (`shiftDistributionAlgorithm.js`, מודול לוגיקה טהור) עם כל המשמרות הקיימות ותאריכי החגים (בפועל, ראו הפער בסעיף הבא — רק שישי-שבת מתגלים כ"מיוחדים").
3. האלגוריתם מחזיר רשימת שיבוצים לימים פנויים בלבד (לא נוגע בימים שכבר משובצים), רשימת ימים שלא ניתן היה לשבץ, וטבלת "צדק" (סה"כ משמרות היסטורי לכל אדם).
4. `AdminSettingsModal` יוצר `Shift` בפועל לכל שיבוץ שהוחזר, ומרענן את `['shifts']` — הלוח מתעדכן לכל המשתמשים.
5. כלי נוסף באותו טאב, "מחיקת משמרות בטווח תאריכים" (`deleteShiftsRangeMutation`), מוחק לצמיתות (עם אישור) את כל המשמרות בטווח — שימושי לפני הרצה חוזרת.

## 8) מעקב ניווט
- `NavigationTracker` מאזין לנתיב הנוכחי בכל שינוי, ומבצע:
  - `postMessage` ל-Parent Iframe עם ה-URL העדכני.
  - `base44.appLogs.logUserInApp()` לצורך ניטור פעילות משתמשים (רק כשהמשתמש מאומת).
