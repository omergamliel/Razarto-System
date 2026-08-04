# תהליכים אפשריים במערכת — מדריך לפי הרשאה

מטרת הקובץ: לרכז, מנקודת מבט תפעולית, **מה כל משתמש יכול לעשות בפועל** במערכת, ומיד לצידו — **איזה קומפוננטה/Mutation אחראית** על כך בקוד, כדי שאפשר יהיה לעקוב אחורה מהתנהגות בממשק אל המקור בקבצים. לפירוט טכני מלא ראו `components_calendar.md`, `components_admin.md`, `components_dashboard.md` ו-`data_flow.md`.

## רמות הרשאה (`AuthorizedPerson.permissions`)
| הרשאה | גישה |
|---|---|
| `View` | צפייה בלוח בלבד; לא יכול לפתוח משמרות/מודאלים (`ShiftCalendar.jsx` → `handleCellClick` חוסם ב-`isViewOnly`), אך יכול לצפות ב-KPI/היכל התהילה/תמיכה. |
| `RR` | כל התהליכים "לכל משתמש עם משמרות" למטה, לגבי המשמרות שלו/שהוא מכוסה בהן. גם משתתף בסבב "חלוקת המשמרות ההוגנת" של מנהל. |
| `Manager` | כל מה ש-`RR` יכול, **ובנוסף** גישה מלאה ל-`AdminSettingsModal.jsx` (זהה ל-`Admin` — אין הבחנה פנימית בין השניים בתוך המודאל). |
| `Admin` | זהה ל-`Manager` בפועל בכל מה שנוגע ל-`AdminSettingsModal.jsx` (`ShiftCalendar.jsx`: `isAdmin = permissions === 'Admin' || permissions === 'Manager'`). |

הבדיקה נעשית בכל מקום לפי `authorizedPerson.permissions` שנטען מה-Backend דרך `AuthorizedPerson` (לא לפי משהו שנשמר בצד הלקוח).

---

## תהליכים לכל משתמש מחובר (כולל `View`)

| תהליך | קומפוננטה/לוגיקה אחראית |
|---|---|
| חיבור ראשוני של משתמש חדש (קישור החשבון האישי לרשומת ההרשאה) | `OnboardingModal.jsx`, מופעל ע"י `linkUserMutation` ב-`ShiftCalendar.jsx` |
| צפייה בלוח משמרות (חודשי/שבועי) | `CalendarHeader.jsx` (ניווט/מיתוג), `CalendarGrid.jsx`, `ShiftCell.jsx` |
| צפייה במדדי KPI (בקשות פתוחות/חלקיות/היסטוריה/המשמרות שלי) | `KPIHeader.jsx` + `KPIListModal.jsx` |
| צפייה ב"היכל התהילה" | `HallOfFameModal.jsx` |
| תמיכה ועזרה / שאלות נפוצות | `HelpSupportModal.jsx` |
| התנתקות | דיאלוג אישור מוטבע ב-`ShiftCalendar.jsx` + `logoutMutation` (`base44.auth.logout()`) |

---

## תהליכים למשתמש עם משמרות (`RR`, `Manager`, `Admin`)

| תהליך | קומפוננטה/Mutation אחראית |
|---|---|
| פתיחת פרטי/פעולות על משמרת שלי (רגילה) | `ShiftActionModal.jsx` |
| פתיחת פרטי משמרת של אחר, או משמרת שלי שאינה רגילה (בבקשה/כיסוי) | `ShiftDetailsModal.jsx` |
| בקשת החלפה מלאה או חלקית על משמרת בודדת שלי | `SwapRequestModal.jsx` → `requestSwapMutation` (`ShiftCalendar.jsx`) → `SwapSuccessModal.jsx` |
| ביטול בקשת החלפה שפתחתי | `cancelSwapMutation` / `cancelSwapRequestMutation` (`ShiftCalendar.jsx`), מופעל מ-`ShiftDetailsModal.jsx` או `KPIListModal.jsx` |
| הצעת כיסוי (מלא או מקטע חלקי) לבקשה פתוחה של אחר | `AcceptSwapModal.jsx` → `offerCoverMutation` (`ShiftCalendar.jsx`) |
| ביטול ההשתתפות שלי בכיסוי שכבר נתתי | `cancelMyCoverageMutation` (`ShiftCalendar.jsx`) |
| הצעת "ראש בראש" ליעד ספציפי (משמרת אחת שלי מול משמרת אחת של מישהו אחר) | `HeadToHeadSelectorModal.jsx` — יוצר `SwapRequest` (`Head2Head`) בפועל ומציג דיאלוג הצלחה עם קישור וואטסאפ אופציונלי |
| אישור "ראש בראש" שהתקבל דרך קישור וואטסאפ | `HeadToHeadApprovalModal.jsx` (נפתח לפי פרמטרים ב-URL, ב-`ShiftCalendar.jsx`) |
| קבלה/דחייה של בקשת "ראש בראש" נכנסת מרשימת ה-KPI | כפתורי "קבל"/דחייה ב-`KPIListModal.jsx` → `acceptHeadToHeadRequestMutation` (`ShiftCalendar.jsx`) |
| "בקשת החלפה מרובה" — הצעת כמה משמרות שלי בתמורה למשמרות של אחר/ים | כרטיס פעולה סגול ב-`KPIHeader.jsx` → מכונת מצבים `switchFlow` + `SwitchFlowBand.jsx` (פס תחתון) + הדגשת תאים ב-`ShiftCell.jsx` → `switchRequestMutation` (`ShiftCalendar.jsx`) |
| שליחת המשמרות שבחרתי כ"בקשה כללית" פתוחה לכולם (בלי לבחור יעד) | כפתור "שלח כבקשה כללית" ב-`SwitchFlowBand.jsx` → `generalSwitchRequestMutation` (`ShiftCalendar.jsx`) |
| קבלת בקשה כללית של מישהו אחר "בלי תמורה" | כפתור "קח את המשמרות" ב-`KPIListModal.jsx` → `acceptGeneralRequestMutation` (`ShiftCalendar.jsx`) |
| הצעת "ראש בראש" בתגובה לבקשה כללית של מישהו אחר | כפתור "הצע ראש בראש" ב-`KPIListModal.jsx` → `handleStartCounterOffer` (`ShiftCalendar.jsx`), ממשיך כ"בקשת החלפה מרובה" עם יעד ממולא מראש |
| הוספת משמרת ליומן Google האישי | `handleAddToCalendar` ב-`ShiftDetailsModal.jsx` וב-`KPIListModal.jsx` |
| שיתוף/שיתוף-חוזר של בקשה בוואטסאפ | לוגיקה משותפת ב-`whatsappTemplates.jsx` (`buildSwapTemplate`, `buildHeadToHeadTemplate`, `buildShiftDeepLink`, `buildHeadToHeadDeepLink`), מופעלת מ-`ShiftDetailsModal.jsx`, `SwapSuccessModal.jsx`, `HeadToHeadSelectorModal.jsx` ו-`KPIListModal.jsx` |

---

## תהליכים למנהל בלבד (`Manager` או `Admin`)

כל התהליכים הבאים דורשים `isAdmin` (כלומר `Admin` **או** `Manager` — שתי ההרשאות מקבלות גישה זהה; אין כרגע חלוקת סמכויות ביניהן בתוך `AdminSettingsModal.jsx`).

| תהליך | קומפוננטה/Mutation אחראית |
|---|---|
| פתיחת לוח הניהול | כפתור "לוח ניהול" ב-`CalendarHeader.jsx` → `AdminSettingsModal.jsx` |
| הוספת משמרת חדשה (ריקה) בתאריך מסוים | `AddShiftModal.jsx` → `addShiftMutation` (`ShiftCalendar.jsx`) |
| שינוי/עדכון שיוך משתמש למשמרת קיימת | `EditRoleModal.jsx` → `editRoleMutation` (`ShiftCalendar.jsx`) |
| שיוך מחדש (reassign) מלא של משמרת לאדם אחר, מתוך פרטי המשמרת | תוך `ShiftDetailsModal.jsx` (`reassignMutation`) |
| מחיקת משמרת | `deleteShiftMutation` (`ShiftCalendar.jsx`), מופעל מ-`ShiftActionModal.jsx`/`ShiftDetailsModal.jsx` |
| אישור החלפה ידני (`approveSwapMutation`, נתיב ישן/משני) | `ShiftDetailsModal.jsx` (`onApprove`) |
| הוספה/עריכה/מחיקה של משתמשים והרשאות, כולל הזמנה בפועל להתחברות לפלטפורמה | טאב "משתמשים" ב-`AdminSettingsModal.jsx` (`addUserMutation`, `updateUserMutation`, `deleteUserMutation`, `base44.users.inviteUser`) |
| שליחת הודעת הזמנה בוואטסאפ למשתמש קיים | `handleSendInvite` בטאב "משתמשים" (`AdminSettingsModal.jsx`) |
| **חלוקת משמרות הוגנת** על טווח תאריכים (עד 2 משמרות/שבוע לאדם, שישי-שבת יחד) | טאב "חלוקת משמרות" ב-`AdminSettingsModal.jsx` → `distributeShifts()` (`shiftDistributionAlgorithm.js`) → יצירת `Shift` בפועל לכל שיבוץ |
| מחיקת כל המשמרות בטווח תאריכים (למשל לפני הרצה חוזרת של חלוקה) | אותו טאב, `deleteShiftsRangeMutation` |
| העלאת/שינוי לוגו האפליקציה | לחיצה על הלוגו ב-`CalendarHeader.jsx` (`handleFileUpload` → `base44.integrations.Core.UploadFile`) |
| עיון בטאבי "הגדרות מערכת", "תמיכה/FAQ", "ערכת נושא", "לוגים" | אותם טאבים ב-`AdminSettingsModal.jsx` — **הערה: אלה state מקומי בלבד, לא נשמרים ל-Backend, ומתאפסים ברענון** |

---

## דברים שחשוב שמנהל יידע — פערים ומגבלות ידועים

- **התראות Toast של `sonner` לא מוצגות בפועל.** רוב ה-Mutations ב-`ShiftCalendar.jsx`, `AdminSettingsModal.jsx` ו-`CalendarHeader.jsx` קוראים ל-`toast.success/error` מ-`'sonner'`, אבל ה-`<Toaster/>` של sonner אף פעם לא מותקן ב-`App.jsx` (רק `@/components/ui/toaster` מותקן שם) — כך שהודעות הצלחה/שגיאה מ"sonner" נבלעות בשקט. הפעולה עצמה כן מתבצעת; רק ההודעה לא מוצגת. שני התהליכים היחידים שקיבלו בכוונה משוב שאינו-Toast (עקב הבעיה הזו) הם `HeadToHeadSelectorModal.jsx` (דיאלוג הצלחה ממורכז) ו-`SwitchFlowBand.jsx` (אזהרה מוטבעת בפס).
- **חלוקת משמרות הוגנת לא מזהה חגים אמיתיים בפועל**, חרף הטקסט בממשק שמתאר החרגת חול המועד וצירוף חג לשישי-שבת — `useHolidays.js` מחזיר מבנה נתונים אחר ממה שהצרכנים (`AdminSettingsModal.jsx`, `CalendarGrid.jsx`) מצפים לקרוא, ו-`distributeShifts()` לא מקבל בפועל פרמטר לחול המועד. בפועל מתבצע צירוף רק לימי שישי-שבת. ראו `components_calendar.md` (`useHolidays.js` / `shiftDistributionAlgorithm.js`).
- **טאבי "הגדרות מערכת", "תמיכה/FAQ", "ערכת נושא" ו"לוגים" הם דמו בלבד** — כל שינוי בהם אובד ברענון הדף.
- **`Admin` ו-`Manager` הם בפועל הרשאה אחת** מנקודת המבט של לוח הניהול — אין כרגע דרך להגביל `Manager` מפעולות רגישות (כמו מחיקת משתמשים) בלי גם להגביל `Admin`.
