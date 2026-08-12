// Static dummy data for the "Monitor/Logs" tab in AdminSettingsModal.
// None of this is real telemetry — it's display-only placeholder content.
export const MONITOR_CHECKS = [
  { id: "storage", label: "אחסון מערכת", detail: "קצב קריאה/כתיבה תקין", status: "ok" },
  { id: "security", label: "תאימות אבטחה", detail: "חיבורים חתומים ותוקפים", status: "ok" },
  { id: "database", label: "מסד נתונים", detail: "חיבור יציב", status: "ok" },
  { id: "oauth", label: "OAUTH Google", detail: "זמין ומאושר", status: "ok" },
  { id: "notifications", label: "חיווי התראות", detail: "שליחת פושים ולמייל פעילה", status: "ok" },
  { id: "backup", label: "גיבוי יומי", detail: "נשמר ב-03:00", status: "ok" },
];

// Default seed group names ("קבוצות"), Hebrew ordinals 1–24 using standard
// gematria (15=טו, 16=טז). Groups are now DYNAMIC — each group is a ShiftSegment
// row (symbol + optional active member), and admins add/remove them from the
// "ניהול קבוצות" tab. This list is only the one-click default set offered when
// no groups exist yet; AuthorizedPerson.sign and ShiftSegment.symbol are plain
// strings with no fixed enum.
export const DEFAULT_GROUP_SYMBOLS = [
  "א",
  "ב",
  "ג",
  "ד",
  "ה",
  "ו",
  "ז",
  "ח",
  "ט",
  "י",
  "יא",
  "יב",
  "יג",
  "יד",
  "טו",
  "טז",
  "יז",
  "יח",
  "יט",
  "כ",
  "כא",
  "כב",
  "כג",
  "כד",
];

export const LOG_TYPE_OPTIONS = [
  "בקשות החלפה",
  "כניסות משתמשים",
  "שינויים בהרשאות",
  "הוספת משמרות",
  "מחיקת משמרות",
  "שיתופים (WhatsApp, יומן)",
  "עדכון מערכת",
];