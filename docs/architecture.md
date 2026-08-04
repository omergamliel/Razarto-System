# ארכיטקטורה כללית

## שכבות מרכזיות
1. **UI / Components** – קומפוננטות React (דף יחיד, מודאלים, תצוגות).
2. **State & Data** – `@tanstack/react-query` + hooks מקומיים (`useState`/`useMemo`).
3. **Auth & Context** – `AuthContext` מספק מידע על סטטוס האימות של המשתמש.
4. **SDK Integration** – לקוח `base44` יחיד משמש לכל קריאה ל-Auth, Entities ו-Integrations.
5. **Infrastructure** – Vite (עם תוסף `@tailwindcss/vite` ל-Tailwind v4) + Oxlint לבדיקת קוד.

## תצורת App ברמה גבוהה
- `main.jsx` מאתחל את React ומטעין CSS גלובלי.
- `App.jsx` עוטף את האפליקציה בספקים (`AuthProvider`, `QueryClientProvider`) ומגדיר את הראוטינג.
- `pages.config.js` מגדיר את מפת הדפים, ומציין מהו הדף הראשי.

## שרשרת כניסה (Bootstrap)
1. נטען `main.jsx`.
2. נטען `App.jsx` שמקים Router ו-Providers.
3. `AuthProvider` בודק מצב הרשאות וטעינת Public Settings.
4. אם יש שגיאת הרשאה מסוג `user_not_registered` → מוצג מסך `UserNotRegisteredError`.
5. אם יש שגיאת `auth_required` → ניתוב אוטומטי למסך התחברות (`navigateToLogin`).
6. אם אין שגיאה → נבנים Routes לפי `pages.config.js`.

## מודולים קריטיים
- **AuthContext** – בודק את מצב האימות מול Base44 וחושף `isAuthenticated`/`authError`/`navigateToLogin`.
- **ShiftCalendar** – קומפוננטת הליבה: שולפת את כל הנתונים (משמרות, בקשות, כיסויים, משתמשים), מנהלת את מצב כל המודאלים **וגם** מכונת המצבים של תהליך "בקשת החלפה מרובה" (`switchFlow`), ומבצעת את כל פעולות ה-CRUD מול Base44 (כולל קיבוץ בקשות Head2Head לפי בעלים וניקוי עצלני (lazy cleanup) של בקשות/סטטוסים שפג תוקפם).
- **CalendarHeader/CalendarGrid/ShiftCell** – משולש UI המרכזי של הלוח. `CalendarGrid` גם שולף חגים דרך `useHolidays` ומעביר את מצב `switchFlow` הלאה ל-`ShiftCell` כדי לסמן תאים נבחרים/זכאים/מוחשכים.
- **shiftDistributionAlgorithm.js** – מודול לוגיקה טהור (ללא UI, ללא קריאות Base44) המחשב חלוקה הוגנת של משמרות על פני טווח תאריכים; נקרא ע"י `AdminSettingsModal`.
- **useHolidays.js** – Hook השוכן ב-`components/calendar` (לא ב-`src/hooks`) שמביא חגים מ-API של Hebcal; נצרך ע"י `CalendarGrid` (תג חג על תא) וע"י `AdminSettingsModal` (טווח החלוקה ההוגנת).

## אינטגרציות חיצוניות
- **Base44 Entities**: `Shift`, `SwapRequest`, `ShiftCoverage`, `AuthorizedPerson`, `AppSettings`, `RoleDefinition` – כולן נקראות ישירות דרך `base44.entities.*`.
- **Base44 Core Integrations**: נקראות ישירות דרך `base44.integrations.Core.*` היכן שנדרש (למשל `UploadFile` בהעלאת לוגו ב-`CalendarHeader`).

## פריסה ומודולריות
המערכת מחולקת באופן ברור לפי דומיין:
- `components/calendar/` – לוגיקה עסקית של משמרות והחלפות (כולל שני מודולים שאינם קומפוננטות UI: `whatsappTemplates.jsx` ו-`shiftDistributionAlgorithm.js`, וה-Hook `useHolidays.js`).
- `components/admin/` – ניהול משתמשים והרשאות, וכן חלוקת משמרות הוגנת ומחיקת משמרות בטווח (טאב "חלוקת משמרות").
- `components/dashboard/` – תצוגות KPI/תמיכה, כולל כרטיס-פעולה (לא ספירה) שמפעיל את תהליך "בקשת החלפה מרובה".
- `components/onboarding/` – מסך חיבור ראשוני של משתמש חדש.
- `components/ui/` – שכבת קומפוננטות בסיסית (shadcn/ui) לשימוש חוזר; רוב הקבצים בתיקייה זו אינם בשימוש בפועל כרגע מכיוון שהאפליקציה מציגה דף יחיד.

## מודל בקשות ההחלפה (SwapRequest) – הרחבה
`SwapRequest` עבר מ-`shift_id`/`offered_shift_id` יחידים למערכים: `shift_ids[]` (המשמרות של המבקש, יכול לכלול כמה) ו-`offered_shift_ids[]` (המשמרות של הצד השני שמבוקשות בתמורה). `request_type` כולל כיום ארבע ערכים: `Full`, `Partial`, `Head2Head` (כולל גם החלפה ממוקדת שנוצרה מתוך "בקשת החלפה מרובה") ו-`General` (בקשה פתוחה לכולם, ללא יעד ספציפי — כל משתמש יכול לקחת את המשמרות כמו שהן או להגיב בהצעת ראש-בראש). כל צרכני השדה הזה (`ShiftCalendar`, `whatsappTemplates.jsx`, `KPIListModal.jsx`, `ShiftDetailsModal.jsx`) עובדים מול המערכים, לא מול ערך יחיד.

## פערים ידועים
- **אינטגרציית חגים לא שלמה:** `useHolidays.js` מחזיר כרגע מפה שטוחה של `תאריך → תווית` (ולא אובייקט `{ labels, cholHamoedDates }`), בעוד ש-`CalendarGrid.jsx` וה-`AdminSettingsModal.jsx` קוראים ל-`holidaysData?.labels` ו-`holidaysData?.cholHamoedDates` — כך שבפועל שני השדות האלה תמיד מתקבלים ריקים. התוצאה: תג החג על תאי הלוח אינו מוצג, וב"חלוקה הוגנת" (`shiftDistributionAlgorithm.js`, שגם אינו מקבל פרמטר `cholHamoedDates` כלל) בפועל מזוהים רק ימי שישי-שבת כ"מיוחדים" — חגים אמיתיים וימי חול המועד אינם נכללים, חרף הטקסט בממשק שמתאר התנהגות הוליסטית יותר.
