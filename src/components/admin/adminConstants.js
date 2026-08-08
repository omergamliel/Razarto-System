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

export const LOG_TYPE_OPTIONS = [
  "בקשות החלפה",
  "כניסות משתמשים",
  "שינויים בהרשאות",
  "הוספת משמרות",
  "מחיקת משמרות",
  "שיתופים (WhatsApp, יומן)",
  "עדכון מערכת",
];