# Hooks מותאמים (`src/hooks`)

## `use-mobile.jsx`
**מטרה:** זיהוי האם המשתמש נמצא במסך קטן (Mobile).

**פונקציות:**
- `useIsMobile()` – מאזין ל־`matchMedia` ומחזיר בוליאן אם רוחב המסך קטן מ-768px.

**קונטקסט שימוש:**
- התאמת תצוגה או לוגיקה עבור מובייל בקומפוננטות שונות.

## `components/calendar/useHolidays.js` (Hook נוסף, לא בתיקייה זו)
קיים Hook נוסף באפליקציה שאינו גר ב-`src/hooks` אלא ב-`src/components/calendar/useHolidays.js` — מביא חגים יהודיים מ-Hebcal לצריכה ב-`CalendarGrid.jsx` וב-`AdminSettingsModal.jsx`. תועד במלואו (כולל פער ידוע בין מה שהוא מחזיר למה שהצרכנים מצפים לקרוא) ב-`docs/components_calendar.md`.
