# קומפוננטות Calendar (`src/components/calendar`)

## `ShiftCalendar.jsx`
**מטרה:** קומפוננטת הליבה של האפליקציה. שולפת את כל הנתונים (משתמש נוכחי, הרשאה, משמרות, בקשות החלפה, כיסויים, משתמשים), מנהלת את מצב כל המודאלים **וגם** את מכונת המצבים של תהליך "בקשת החלפה מרובה" (`switchFlow`), ומבצעת את כל פעולות ה-CRUD מול Base44 דרך `useMutation`.

**Handlers מרכזיים:**
- `closeAllModals()` – סגירה מרוכזת של כל המודאלים.
- `handleCellClick(date, shift)` – כשאין `switchFlow` פעיל: פתיחת המודאל המתאים לפי תא שנלחץ (הוספה/פעולה/פרטים, בהתאם להרשאות ולסטטוס המשמרת). כש-`switchFlow` פעיל: מיירט את הלחיצה לפני כל לוגיקה אחרת ומוסיף/מוריד את המשמרת מרשימת הבחירה של השלב הנוכחי (`ownShiftIds`/`targetShiftIds`), עם חסימה של תאים לא זכאים (לא רגילים/עברו/לא בבעלות הנכונה).
- `handleOfferCover(shift)` – פתיחת תהליך הצעת כיסוי משמרת (`AcceptSwapModal`).
- `handleOpenSwapRequest(shift)` – פתיחת מודאל יצירת בקשת החלפה.
- `handleSwapSubmit(data)` – שליחת בקשת החלפה ל-Backend (Full/Partial) ורענון ה-Query-ים.
- `handleStartCounterOffer(request)` – פתיחת `switchFlow` במצב "הצעת ראש-בראש נגדית" מתוך בקשה כללית (`General`) של מישהו אחר: מְמַלֵּא מראש את `targetShiftIds` מתוך משמרות הבקשה המקורית, ומשאיר למשתמש רק לבחור את המשמרות שלו.

**תהליך "בקשת החלפה מרובה" (`switchFlow`):** מופעל מכרטיס הפעולה ב-`KPIHeader` (`onStartSwitchFlow`). `switchFlow` הוא `{ step: 'own' | 'target', ownShiftIds, targetShiftIds, isCounterOffer?, targetOwnerName? }`. שלב `'own'`: המשתמש בוחר כמה מהמשמרות העתידיות שלו. שלב `'target'`: בוחר משמרות של אחרים לקבל בתמורה (כל המשמרות שנבחרו חייבות להיות של אדם אחד בלבד — נבדק ומוצגת אזהרה אם לא). מוצג ע"י `SwitchFlowBand` בתחתית המסך, וההדגשה/ההחשכה של התאים מתבצעת ב-`ShiftCell`. שלוש דרכי סיום לשלב 'target':
  - **אישור ושליחה** (`switchRequestMutation`) – יוצר בקשת `SwapRequest` אחת מסוג `Head2Head` לכל בעלים ייחודי של משמרת-מטרה (מקבץ `offered_shift_ids` לפי בעלים), עם `shift_ids` המשותף של כל המשמרות שהמשתמש בחר להציע; מעדכן את המשמרות של המשתמש לסטטוס `Swap_Requested`.
  - **שלח כבקשה כללית** (`generalSwitchRequestMutation`, ה-"skip" של שלב 'target') – יוצר בקשה יחידה מסוג `General` עם `offered_shift_ids: []` (פתוחה לכולם, בלי יעד ספציפי).
  - **ביטול** – מאפס את `switchFlow` בכל שלב, ללא שינוי בנתונים.
- **קבלת בקשה כללית** (`acceptGeneralRequestMutation`, מופעל מ-`KPIListModal`) – מעביר את כל משמרות `shift_ids` של הבקשה לבעלות המקבל ("לקיחה בלי תמורה"), סוגר את הבקשה, ומבטל כל בקשה אחרת שהתייחסה לאותן משמרות.
- **קבלת בקשת ראש-בראש נכנסת** (`acceptHeadToHeadRequestMutation`, מופעל מ-`KPIListModal`) – מחליף בעלות דו-כיוונית בין `shift_ids` (של המבקש) ל-`offered_shift_ids` (של המקבל), סוגר את הבקשה, ומבטל בקשות אחרות שהתייחסו לאותן משמרות משני הצדדים.
- **ניקוי עצלני (Lazy cleanup)** – `useEffect` שרץ בכל טעינה: מוחק בקשות פעילות (`Open`/`Partially_Covered`) שתאריכן עבר, ומחזיר משמרות "יתומות" (שנשארו בסטטוס `Swap_Requested`/`Partially_Covered` בלי בקשה חיה מאחוריהן) לסטטוס `Active`.
- **קישורים עמוקים (Deep links)** – `useEffect` שקורא פרמטרי URL (`openShiftId`, או `headToHeadTarget`+`headToHeadOffer`) בעת הטעינה, פותח את `ShiftDetailsModal`/`HeadToHeadApprovalModal` בהתאם, ומנקה אותם מה-URL.

**מסך טעינה/הרשאות:**
- לפני הצגת הלוח, הקומפוננטה בודקת אם המשתמש קיים בטבלת `AuthorizedPerson` (`UserNotRegisteredError` אם לא), ואם עדיין לא חובר לחשבון מוצג `OnboardingModal`.

**מודאלים/רכיבים שהיא מרכיבה:** `CalendarHeader`, `CalendarGrid`, `KPIHeader`, `AdminSettingsModal`, `ShiftActionModal`, `SwapRequestModal`, `AddShiftModal`, `EditRoleModal`, `ShiftDetailsModal`, `AcceptSwapModal`, `SwapSuccessModal`, `HeadToHeadSelectorModal`, `HeadToHeadApprovalModal`, `HallOfFameModal`, `HelpSupportModal`, `KPIListModal`, `SwitchFlowBand`, `BackgroundShapes`, `LoadingSkeleton`.

---

## `CalendarHeader.jsx`
**מטרה:** פס עליון עם ניווט בתאריכים, לוגו, פעולות מנהל וסטטוס משתמש.

**פונקציות:**
- `getTimeBasedGreeting()` – ברכה לפי שעה.
- `navigatePrev()` / `navigateNext()` – שינוי תאריך לפי `viewMode`.
- `formatTitle()` – כותרת תאריך לפי חודש/שבוע.
- `handleLogoClick()` – פתיחת בחירת קובץ עבור מנהל.
- `handleFileUpload(e)` – העלאת לוגו דרך `base44.integrations.Core.UploadFile`.

---

## `CalendarGrid.jsx`
**מטרה:** יצירת גריד ימים (חודשי/שבועי) והצגת `ShiftCell` לכל יום.

**פונקציות:**
- `getEnrichedShift(shift)` – העשרת משמרת בפרטי משתמש (שם, מחלקה) מתוך `AuthorizedPerson`.
- `getDaysToDisplay()` – יצירת רשימת ימים לפי תצוגה (חודש/שבוע).
- `getShiftForDate(date)` – מציאת המשמרת התואמת לתאריך נתון.

---

## `ShiftCell.jsx`
**מטרה:** תא יומי בגריד עם סטטוס משמרת.

**פונקציות:**
- `handleClick()` – מעביר `date` ו־`shift` ל־callback (`onClick`).
- `getStatusStyles()` – בחירת צבעים/אייקונים לפי סטטוס המשמרת (רגילה/בקשת החלפה/חלקית/מכוסה).

**שדות נגזרים:**
- `nameLines` – רשימת שמות המשתתפים במשמרת (בעל המשמרת + מכסים), מחושבת עם `useMemo`.

---

## `ShiftActionModal.jsx`
**מטרה:** מודאל פעולות מהיר על משמרת של המשתמש עצמו (בקשת החלפה / עריכת שיבוץ למנהל / מחיקה).

**פונקציות:**
- `handleDelete()` – מחיקת המשמרת (לאחר אישור בדיאלוג).

**כפתורי בקשת החלפה:** שני כפתורים נפרדים – "בקשת החלפה מלאה" ו"בקשת החלפה חלקית" – קוראים ל־`onRequestSwap('full' | 'partial')`, כדי לפתוח את `SwapRequestModal` כשהוא כבר ממוקד בסוג הרצוי (ר' `initialSwapType` למטה).

---

## `SwapRequestModal.jsx`
**מטרה:** פתיחת בקשת החלפה מלאה או חלקית, כולל סליידר טווח שעות.

**Props נוסף:** `initialSwapType` ('full' | 'partial', ברירת מחדל 'full') – קובע איזו לשונית (מלא/חלקי) פתוחה כשהמודאל נטען; משמש את `ShiftActionModal` כדי לפתוח ישירות בלשונית הנכונה לפי הכפתור שנלחץ.

**פונקציות:**
- `handleSliderDrag(e, handleIndex)` – גרירת קצה טווח השעות ב־UI.
- `updateInputsFromRange(newRange)` – סנכרון שדות הקלט עם טווח השעות שנבחר.
- `handleManualInputChange(type, val)` – עדכון ידני של שעת התחלה/סיום.
- `handleSubmit(e)` – בניית Payload ושליחתו ל־`onSubmit`.
- `formatDisplayDate(isoDateStr)` – פורמט תאריך להצגה.

---

## `AddShiftModal.jsx`
**מטרה:** הוספת משמרת חדשה ע״י מנהל (בחירת מחלקה ואז משתמש).

**פונקציות:**
- `handleSubmit(e)` – בניית משמרת עם תאריכים ושעות ברירת מחדל ושליחה ל־`onSubmit`.
- `handleDepartmentChange(value)` – עדכון מחלקה וניקוי בחירת המשתמש.

---

## `EditRoleModal.jsx`
**מטרה:** שינוי שיוך המשתמש (התפקיד) למשמרת קיימת, ע״י מנהל.

**פונקציות:**
- `handleSubmit(e)` – שליחת עדכון המשתמש המשובץ למשמרת.
- `handleDepartmentChange(value)` – בחירת מחלקה וניקוי בחירת המשתמש.

---

## `AcceptSwapModal.jsx`
**מטרה:** קבלת/הצעת כיסוי לבקשת החלפה קיימת (מלא או חלקי, כולל בחירת מקטע כיסוי ספציפי).

**פונקציות:**
- `formatSegmentText(segment)` – פורמט טווח זמן להצגה.
- `handleSubmit(e)` – בניית נתוני הכיסוי ושליחה ל־`onAccept`.

**לוגיקה מרכזית:**
- משתמשת ב־`normalizeShiftContext`, `computeCoverageSummary`, `resolveSwapType` (מ־`whatsappTemplates.jsx`) כדי לחשב חלונות זמן ופערי כיסוי.

---

## `ShiftDetailsModal.jsx`
**מטרה:** הצגת פרטי משמרת מלאים – מי משובץ, סטטוס, פערי כיסוי, ופעולות זמינות (ביטול בקשה, הצעת כיסוי, ראש-בראש, הוספה ליומן, שיתוף בוואטסאפ, ולמנהל גם שיוך מחדש ומחיקה).

**פונקציות:**
- `handleDelete()` – מחיקת משמרת (למנהל, לאחר אישור).
- `formatSegment(start, end)` – תיאור טווח כיסוי קצר.
- `formatSegmentNarrative(start, end)` – ניסוח טקסטואלי מלא לטווח כיסוי.
- `handleAddToCalendar()` – פתיחת קישור להוספת האירוע ל-Google Calendar.
- `handleWhatsAppShare()` – שיתוף בקשת ההחלפה דרך WhatsApp (`buildSwapTemplate` + `buildShiftDeepLink`).

**הערה:** למנהל יש בנוסף מודאל פנימי לשיוך המשמרת מחדש למשתמש אחר (`reassignMutation`).

**כפתורי בקשת החלפה (`canRequestSwap`):** כמו ב־`ShiftActionModal.jsx`, שני כפתורים נפרדים – "בקשת החלפה מלאה" ו"בקשת החלפה חלקית" – קוראים ל־`onRequestSwap('full' | 'partial', shift)`. `ShiftCalendar.jsx` מתעלם מהארגומנט `shift` (המשמרת כבר `selectedShift`) ומשתמש רק בסוג כדי לקבוע את `initialSwapType` של `SwapRequestModal`.

---

## `SwapSuccessModal.jsx`
**מטרה:** מסך הצלחה לאחר שליחת בקשת החלפה.

**פונקציות:**
- `handleWhatsAppShare()` – שיתוף הודעת הבקשה בוואטסאפ מיד אחרי היצירה.

---

## `HeadToHeadSelectorModal.jsx`
**מטרה:** בחירת אחת מהמשמרות העתידיות של המשתמש, כדי להציע אותה בתמורה למשמרת מטרה, ופתיחת בקשת החלפה אמיתית (לא רק הודעת WhatsApp).

**פונקציות:**
- `handleSelectShift(shift)` – בחירת משמרת להצעה.
- `createH2HRequestMutation` – יוצר `SwapRequest` אמיתי מסוג `Head2Head` (`shift_ids: [selectedShift.id]`, `offered_shift_ids: [targetShift.id]`), ומעדכן את המשמרת שנבחרה לסטטוס `Swap_Requested`.
- `handleSendProposal()` – מפעיל את היצירה; בהצלחה סוגר את המודאל ופותח דיאלוג הצלחה במרכז המסך (לא Toast — ראו הערה למטה) עם אפשרות לשתף בוואטסאפ.
- `buildWhatsappUrl()` – בונה קישור WhatsApp אופציונלי (`buildHeadToHeadTemplate` + `buildHeadToHeadDeepLink`) שמוצג רק כפעולת המשך בדיאלוג ההצלחה, ולא כדרך היחידה ליצור את הבקשה.

**הערה:** לא נעשה שימוש ב-Toast (לא `sonner` ולא `@/components/ui/toast`) — שניהם שבורים באפליקציה הזו (ראו `docs/lib_modules.md`/`docs/ui_components.md`). מצב ההצלחה/שגיאה מנוהל ב-state מקומי (`successPrompt`, `errorMessage`) ומוצג כדיאלוג ממורכז עם כפתור סגירה שעובד בפועל.

---

## `HeadToHeadApprovalModal.jsx`
**מטרה:** אישור/דחייה של החלפה "ראש בראש" בין שתי משמרות (המשמרת שהמשתמש נותן מול זו שהוא מקבל).

**פונקציות:**
- `getShiftInfo(id)` – שליפת נתוני משמרת ושם המשתמש המשויך אליה.
- `ShiftCard({ shift, label, type })` – קומפוננטת עזר פנימית להצגת כרטיס משמרת (יוצאת/נכנסת).

---

## `BackgroundShapes.jsx`
**מטרה:** שכבת רקע דקורטיבית (עיגולי גרדיאנט מטושטשים + דפוס נקודות) מאחורי הלוח.

---

## `whatsappTemplates.jsx`
**מטרה:** לוגיקה משותפת (ללא UI) לחישוב חלונות זמן, פערי כיסוי, ובניית הודעות/קישורי WhatsApp. משמש כמעט את כל מודאלי הלוח.

**פונקציות:**
- `resolveSwapType(shift, activeRequest)` – קביעה אם הבקשה Full/Partial.
- `resolveRequestWindow(shift, activeRequest)` – חישוב חלון הזמן של הבקשה.
- `buildDateTime(dateStr, timeStr)` – בניית אובייקט `Date` מאוחד מתאריך ושעה נפרדים.
- `normalizeCoverageEntry(coverage, fallbackWindow)` – התאמת שדות זמן של רשומת כיסוי.
- `resolveShiftWindow(shift, requestWindow)` – חישוב חלון הזמן של המשמרת המקורית.
- `calculateMissingSegments(baseStart, baseEnd, coverageEntries)` – איתור פערים שטרם כוסו בטווח נתון.
- `computeCoverageSummary({ shift, activeRequest, coverages })` – תקציר כיסויים מלא (חלונות + פערים חסרים).
- `normalizeShiftContext(shift, opts)` – מאחד משמרת + בקשה + כיסויים + נתוני משתמשים לאובייקט תצוגה אחיד; משמש את `ShiftCalendar` להעשרת כל המשמרות.
- `buildShiftDeepLink(shiftId)` – בניית URL שפותח את האפליקציה ישירות עם פרטי משמרת ספציפית.
- `buildHeadToHeadDeepLink(targetId, offerId)` – בניית URL להחלפת ראש-בראש.
- `buildSwapTemplate(...)` – בניית טקסט הודעת WhatsApp לבקשת החלפה.
- `buildHeadToHeadTemplate(...)` – בניית טקסט הודעת WhatsApp להחלפה יזומה (ראש-בראש).

---

## `SwitchFlowBand.jsx`
**מטרה:** פס פעולה קבוע בתחתית המסך, מוצג ע"י `ShiftCalendar` כל עוד `switchFlow` פעיל (תהליך "בקשת החלפה מרובה"). מקבל `step`, `ownCount`/`targetCount`, `isSubmitting`, `warning`, `isCounterOffer`, `targetOwnerName`, ו-callbacks (`onCancel`, `onNext`, `onSkip`, `onConfirm`).

**התנהגות לפי שלב:**
- שלב `'own'` (ולא הצעת נגד): כותרת "בחרו את המשמרות שלכם...", כפתור "המשך" (מנוטרל כשלא נבחר כלום).
- שלב `'target'`: כותרת "בחרו את המשמרות של אחרים...", שני כפתורים — "שלח כבקשה כללית" (`onSkip`, יוצר בקשה מסוג `General`) ו-"אישור ושליחה" (`onConfirm`, יוצר בקשות `Head2Head`).
- מצב הצעת-נגד (`isCounterOffer`): כותרת מותאמת עם שם בעל המשמרת המקורית, וכפתור "אישור ושליחה" יחיד.
- שורת אזהרה אדומה (`warning`) מוצגת מעל הפס כשנבחרה משמרת-מטרה של אדם שני שונה מהראשון (בקשת ראש-בראש יכולה ליעד רק אדם אחד).
- "ביטול" מוצג בכל שלב וסוגר את התהליך בלי לשנות נתונים.

---

## `shiftDistributionAlgorithm.js`
**מטרה:** מודול לוגיקה טהור (ללא UI, ללא קריאות Base44) שמייבא ע"י `AdminSettingsModal` בטאב "חלוקת משמרות". מחשב איך לחלק משמרות על פני טווח תאריכים בצורה הוגנת, מבלי לגעת בימים שכבר משובצים.

**ייצוא יחיד:** `distributeShifts({ people, existingShifts, startDate, endDate, holidayDates })` → `{ assignments, skipped, justiceTable }`.

**עקרונות (לפי `tasks.txt`):**
- **(א) מכסה שבועית קשה:** לכל אדם עד שתי משמרות בשבוע קלנדרי (א'-ש'). זו האילוץ החזק ביותר בין השלושה.
- **(ב) שישי-שבת יחד:** ימים "מיוחדים" רצופים (שישי/שבת, וגם ימי חג לפי `holidayDates`) מקובצים ל"חבילה" (bundle) שמוקצית לאדם אחד.
- **(ג) חגים:** אותו כלל צירוף כמו (ב), עם `holidayDates`.
- כשחבילה חופפת יותר משבוע קלנדרי אחד, היא מפוצלת בגבול השבוע/המכסה כדי לא להפר את כלל (א) — הימים שלא ניתן לשבץ מדווחים ב-`skipped`.
- "טבלת הצדק" (`justiceTable`) ממוינת לפי סך המשמרות ההיסטורי (מכל הזמנים) לכל אדם — מי שצבר הכי מעט מקבל עדיפות בבחירה.
- **הערה:** הפרמטר `holidayDates` הוא היחיד שהפונקציה בפועל קוראת; קריאה עם `cholHamoedDates` (כמו שנעשה כיום ב-`AdminSettingsModal`) מתעלמת בשקט מהפרמטר הזה — אין בקוד הפונקציה לוגיקה נפרדת לחול המועד (ראו הערה מקבילה ב-`docs/architecture.md` וב-`docs/components_admin.md`).

---

## `useHolidays.js`
**מטרה:** Hook (ולא קומפוננטת UI) שמביא חגים יהודיים מ-API של Hebcal (`hebcal.com/hebcal`) לפי שנה/שנים, ומסנן החוצה קטגוריות לא רלוונטיות (`EXCLUDED_TITLES`, וכל "ערב"). נצרך ע"י `CalendarGrid.jsx` (תג חג על תא) וע"י `AdminSettingsModal.jsx` (טווח החלוקה ההוגנת).

**ייצוא יחיד:** `useHolidays(years = [])` – עוטף `useQuery` עם `queryKey: ['holidays', uniqueYears]` ו-`staleTime` של יום.

**החזרה בפועל:** מפה שטוחה `{ 'yyyy-MM-dd': 'שם החג' }`.

**הערה חשובה — פער בין המחזיר לצרכנים:** `CalendarGrid.jsx` ו-`AdminSettingsModal.jsx` קוראים ל-`holidaysData?.labels` ול-`holidaysData?.cholHamoedDates`, כאילו ה-Hook מחזיר אובייקט `{ labels, cholHamoedDates }`. מכיוון שההחזרה בפועל היא מפה שטוחה (בלי שדה `labels` או `cholHamoedDates`), שני הביטויים האלה מתקבלים כ-`undefined` ומתגלגלים לברירת המחדל (`{}`/`Set()` ריקים) בכל מקום שבו הם נצרכים. בפועל: תג החג לעולם לא מוצג על תאי הלוח, וב"חלוקה ההוגנת" נחשבים "מיוחדים" רק ימי שישי-שבת (ראו `shiftDistributionAlgorithm.js` למעלה).
