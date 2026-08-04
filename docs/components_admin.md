# קומפוננטות Admin (`src/components/admin`)

## `AdminSettingsModal.jsx`
**מטרה:** מסך ניהול ראשי, נגיש לכל מי שההרשאה שלו `Admin` **או** `Manager` (ר' `ShiftCalendar.jsx` — `isAdmin = permissions === 'Admin' || permissions === 'Manager'`; שני התפקידים מקבלים גישה זהה לכל הטאבים, אין הבחנה פנימית נוספת בתוך המודאל עצמו). כולל כמה טאבים: הגדרות, משתמשים והרשאות, תמיכה, ערכת נושא, לוגים, וחלוקת משמרות.

**פונקציות עיקריות (טאב משתמשים):**
- `getPermissionStyle(perm)` – בחירת צבעים לתגית הרשאה.
- `handleSendInvite(user)` – פתיחת WhatsApp עם הודעת הזמנה למערכת.
- `getFilteredPeople()` – חיפוש/סינון אנשי צוות לפי טקסט ומחלקה.
- `handleAddUserSubmit(e)` / `handleEditSubmit(e)` / `handleSavePermissions()` / `handleDeleteConfirm()` – שליחת טפסי הוספה/עריכה/הרשאות/מחיקה של משתמש. הוספת משתמש (`addUserMutation`) גם מזמינה אותו בפועל לפלטפורמה (`base44.users.inviteUser`) כדי שיוכל להתחבר — לא רק רושמת אותו ברשימת ההרשאות.
- `handleCloseAddUser()` – סגירת מודאל יצירת משתמש.

**פונקציות בטאב "חלוקת משמרות" (`activeTab === 'distribution'`):**
- `handleRunDistribution()` / `runDistributionMutation` – מסנן מתוך `AuthorizedPerson` רק את מי שההרשאה שלו `RR` או `Manager` (מנהלים/צופים לא נכנסים לסבב), קורא ל-`distributeShifts()` (`shiftDistributionAlgorithm.js`) על טווח התאריכים שנבחר, ואז יוצר בפועל `Shift` חדש לכל שיבוץ שהאלגוריתם החזיר. מציג טבלת "צדק" (סה"כ משמרות לכל אדם) ורשימת ימים שלא ניתן היה לשבץ (`skipped`).
- `handleRequestDeleteShiftsRange()` / `deleteShiftsRangeMutation` – מוחק לצמיתות את כל המשמרות בטווח תאריכים נבחר (עם דיאלוג אישור); שימושי לניקוי טווח לפני הרצה חדשה של החלוקה ההוגנת.
- שני הכלים חולקים את מפתח ה-Query `['shifts']` עם שאר האפליקציה, כך שתוצאה של האחד (יצירה/מחיקה) מתעדכנת בלוח השנה בלי רענון נפרד.

**פונקציות בטאבים האחרים (System / Support / FAQ / Theme / Monitor / Logs):**
- `handleSystemChange(field, value)`, `handleSupportChange(field, value)`, `handleFaqToggle(id)`, `handleFaqChange(id, field, value)`, `handleAddFaq()`, `moveFaq(id, direction)` – עדכון ה-state המקומי של הטאבים הללו.

**אינטראקציות מול Base44:**
- `AuthorizedPerson.list/create/update/delete` – בטאב המשתמשים.
- `Shift.list/create/delete` (דרך ה-Query המשותף `['shifts']`) – בטאב חלוקת המשמרות.

> **הערה חשובה:** טאבי System Settings, Support/FAQ, Theme Palette ו-Monitor/Logs מוצגים עם נתונים מקומיים (`useState`) בלבד ואינם קוראים ל-Base44 – שינויים בהם לא נשמרים בין רענונים. רק טאבי "משתמשים" ו"חלוקת משמרות" באמת שומרים נתונים.

> **פער ידוע — חגים בחלוקה ההוגנת:** הטאב מציג טקסט שמתאר החרגה של ימי חול המועד וצירוף חגים לשישי-שבת, אך בפועל `useHolidays()` לא מחזיר את השדות (`labels`/`cholHamoedDates`) שהמודאל מנסה לקרוא, ו-`distributeShifts()` לא מקבל פרמטר `cholHamoedDates` כלל — כך שבפועל רק שישי-שבת מטופלים כ"מיוחדים". ר' פירוט ב-`docs/components_calendar.md` (`useHolidays.js` / `shiftDistributionAlgorithm.js`).
