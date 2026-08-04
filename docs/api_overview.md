# שכבת API (Base44 SDK)

## `src/api/base44Client.js`
**מטרה:** יצירת לקוח SDK מרכזי, יחיד, לשימוש בכל שכבות האפליקציה.

**פונקציות/יצוא:**
- `base44` – מופע של `createClient` עם פרמטרים מ-`appParams` (appId, serverUrl, token, functionsVersion).

**קונטקסט שימוש:**
- זהו נקודת החיבור **היחידה** לכל Entity/Auth/Integration באפליקציה. אין קובצי-עזר נוספים (`entities.js`/`integrations.js`) – כל קריאה נעשית ישירות, לדוגמה:
  - `base44.auth.me()`, `base44.auth.logout()` – אימות.
  - `base44.entities.Shift.list()/create()/update()/delete()`, וכן `SwapRequest`, `ShiftCoverage`, `AuthorizedPerson`, `AppSettings`, `RoleDefinition` – ישויות.
  - `base44.integrations.Core.UploadFile(...)` – למשל בהעלאת לוגו ב-`CalendarHeader.jsx`.
  - `base44.users.inviteUser(email, role)` – הזמנת משתמש חדש לפלטפורמה עצמה (לא רק רישום ב-`AuthorizedPerson`), נקרא מתוך `AdminSettingsModal.jsx`.

## מבנה `SwapRequest` בפועל
- **שדות מערך, לא ערך יחיד:** `shift_ids: string[]` (משמרות המבקש) ו-`offered_shift_ids: string[]` (משמרות מבוקשות בתמורה, רלוונטי בעיקר ל-`Head2Head`). כל קריאה/כתיבה באפליקציה עובדת מול המערכים, כולל התייחסות לבקשה שמכילה כמה משמרות בבת אחת (תהליך "בקשת החלפה מרובה" ב-`ShiftCalendar.jsx`).
- **`request_type` כולל 4 ערכים:** `Full`, `Partial`, `Head2Head` (גם מתוך `HeadToHeadSelectorModal` וגם מתוך תהליך ה-switch flow), ו-`General` (בקשה פתוחה לכולם, `offered_shift_ids: []`, שנוצרת מ"שלח כבקשה כללית").
- פירוט מלא של כל התהליכים שיוצרים/צורכים בקשות אלה נמצא ב-`docs/data_flow.md` וב-`docs/manager.md`.
