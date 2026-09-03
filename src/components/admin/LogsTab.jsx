import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  CalendarDays,
  Circle,
  Loader2,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { LOG_TYPE_OPTIONS } from "@/components/admin/adminConstants";

const PAGE_SIZE = 50;

// Human-readable Hebrew names for the entities a log can reference.
const ENTITY_LABELS = {
  Shift: "משמרת",
  SwapRequest: "בקשת החלפה",
  ShiftGroup: "קבוצה",
  AuthorizedPerson: "משתמש",
  ShiftCoverage: "כיסוי משמרת",
  ActivityLog: "רשומת לוג",
  FaqItem: "שאלה נפוצה",
  User: "משתמש",
};

// Hebrew labels for the record fields shown in the detail modal. Unknown keys
// fall back to the raw key name.
const FIELD_LABELS = {
  id: "מזהה",
  original_user_id: "בעל המשמרת",
  requesting_user_id: "המבקש",
  target_user_id: "יעד",
  covering_user_ids: "מכסים",
  actor_id: "מבצע הפעולה",
  request_type: "סוג בקשה",
  status: "סטטוס",
  start_date: "תאריך התחלה",
  end_date: "תאריך סיום",
  date: "תאריך",
  start_time: "שעת התחלה",
  end_time: "שעת סיום",
  shift_type: "סוג משמרת",
  role: "תפקיד",
  notes: "הערות",
  reason: "סיבה",
  symbol: "קבוצה",
  serial_id: "מזהה משתמש",
  full_name: "שם מלא",
  email: "אימייל",
  department: "מחלקה",
  permissions: "הרשאות",
  sign: "קבוצה",
  active: "פעיל",
  offered_shifts: "משמרות מוצעות",
  requested_shifts: "משמרות מבוקשות",
  is_partial_in_progress: "בתהליך כיסוי חלקי",
  created_date: "נוצר בתאריך",
  updated_date: "עודכן בתאריך",
  created_by: "נוצר על ידי",
  // Keys used by the self-contained snapshot stored on the log itself.
  requester: "מבקש ההחלפה",
  owner: "בעל המשמרת",
  shifts: "משמרות",
  count: "כמות",
  from: "מ",
  to: "אל",
  group: "קבוצה",
  giver: "נותן המשמרת",
  taker: "לוקח המשמרת",
  new_owner: "בעלים חדש",
  action_type: "סוג השינוי",
  previous_active_user: "משתמש פעיל קודם",
  new_active_user: "משתמש פעיל חדש",
  setting: "הגדרה",
  previous_value: "ערך קודם",
  new_value: "ערך חדש",
  name: "שם",
  members: "חברים",
  question: "שאלה",
  answer: "תשובה",
  order: "סדר",
  dates: "תאריכים",
  systemStatus: "סטטוס מערכת",
};

// Keys whose value is a single person's serial_id.
const PERSON_KEYS = new Set([
  "original_user_id",
  "requesting_user_id",
  "target_user_id",
  "actor_id",
  "user_id",
]);
// Keys whose value is an array of person serial_ids.
const PERSON_ARRAY_KEYS = new Set(["covering_user_ids"]);
// Keys whose value is an email of a person (resolve to a name).
const EMAIL_PERSON_KEYS = new Set(["created_by"]);
// Keys whose value is a system timestamp (show date + time).
const DATETIME_KEYS = new Set(["created_date", "updated_date"]);
// Fields that don't interest a manager and are hidden from the detail view.
// Raw record/user ids (id, serial_id, entity_id) are meaningless to a manager,
// so they're suppressed — person fields are resolved to names instead.
const HIDDEN_KEYS = new Set([
  "id",
  "is_sample",
  "serial_id",
  "entity_id",
]);

const labelFor = (key) => FIELD_LABELS[key] || key;

// Map an ActivityLog row (base44 entity) into the shape the table renders,
// deriving the display date/time from the system created_date timestamp. Keeps
// the entity/entity_id so a row can be expanded into a full detail view.
function toEntry(log) {
  const ts = log.created_date || log.updated_date;
  const parsed = ts ? new Date(ts) : null;
  const valid = parsed && !isNaN(parsed);
  // The self-contained data snapshot, stored as a JSON string on the log.
  let details = null;
  if (log.details) {
    try {
      details =
        typeof log.details === "string"
          ? JSON.parse(log.details)
          : log.details;
    } catch {
      details = null;
    }
  }
  return {
    id: log.id,
    user: log.actor_name || "לא ידוע",
    actorId: log.actor_id,
    action: log.action || "",
    type: log.type || "",
    status: log.status || "ok",
    entity: log.entity || "",
    entityId: log.entity_id || "",
    details,
    date: valid ? format(parsed, "yyyy-MM-dd") : "",
    displayDate: valid ? format(parsed, "dd/MM/yyyy") : "",
    time: valid ? format(parsed, "HH:mm") : "",
    fullDateTime: valid ? format(parsed, "dd/MM/yyyy HH:mm:ss") : "",
    sortMs: valid ? parsed.getTime() : 0,
  };
}

// --------------------------------------------------------------------------
// Detail modal: given a clicked log entry, fetches the referenced entity
// record (Shift, SwapRequest, ...) and shows every field, resolving user-id
// fields to names via the AuthorizedPerson list.
// --------------------------------------------------------------------------
function LogDetailModal({ entry, onClose }) {
  const open = !!entry;
  const entity = entry?.entity;
  const entityId = entry?.entityId;
  // A self-contained snapshot captured when the log was written. When present
  // it's the source of truth, so the referenced record is NOT fetched — the
  // log stays readable even if that record was later deleted. Live-fetching is
  // only a fallback for legacy logs written before snapshots existed.
  const snapshot =
    entry?.details && typeof entry.details === "object" ? entry.details : null;
  const canFetchEntity =
    open && !snapshot && !!entity && !!base44.entities?.[entity] && !!entityId;

  const { data: people = [] } = useQuery({
    queryKey: ["authorized-people-log-detail"],
    queryFn: () => base44.entities.AuthorizedPerson.list(),
    enabled: open,
  });

  const { data: records = [], isLoading: recordLoading } = useQuery({
    queryKey: ["log-entity-records", entity],
    queryFn: () => base44.entities[entity].list(),
    enabled: canFetchEntity,
    staleTime: 1000 * 30,
  });

  const personBySerial = useMemo(() => {
    const m = new Map();
    people.forEach((p) => m.set(String(p.serial_id), p));
    return m;
  }, [people]);

  const personByEmail = useMemo(() => {
    const m = new Map();
    people.forEach((p) => {
      if (p.email) m.set(String(p.email).toLowerCase(), p);
    });
    return m;
  }, [people]);

  // Managers don't read serial_ids — resolve to the person's name only, never
  // exposing the raw id (not even as a fallback, which would be meaningless).
  const resolvePerson = (id) => {
    if (id == null || id === "") return "—";
    const p = personBySerial.get(String(id));
    return p ? p.full_name : "משתמש לא ידוע";
  };

  const resolveEmailPerson = (email) => {
    if (!email) return "—";
    const p = personByEmail.get(String(email).toLowerCase());
    return p ? p.full_name : String(email);
  };

  const record = useMemo(() => {
    if (snapshot) return snapshot;
    if (!canFetchEntity) return null;
    return records.find((r) => String(r.id) === String(entityId)) || null;
  }, [snapshot, records, entityId, canFetchEntity]);

  // Render one field value, resolving people, timestamps, arrays and nested
  // objects into readable text.
  const renderValue = (key, value) => {
    if (value === null || value === undefined || value === "")
      return <span className="text-gray-400">—</span>;

    if (PERSON_KEYS.has(key)) return resolvePerson(value);

    if (EMAIL_PERSON_KEYS.has(key)) return resolveEmailPerson(value);

    if (PERSON_ARRAY_KEYS.has(key)) {
      const arr = Array.isArray(value) ? value : [];
      if (arr.length === 0) return <span className="text-gray-400">—</span>;
      return arr.map((id) => resolvePerson(id)).join(", ");
    }

    if (typeof value === "boolean") return value ? "כן" : "לא";

    if (DATETIME_KEYS.has(key)) {
      const d = new Date(value);
      return isNaN(d) ? String(value) : format(d, "dd/MM/yyyy HH:mm:ss");
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-gray-400">—</span>;
      // Array of objects (e.g. offered_shifts) → nested key/value blocks.
      if (typeof value[0] === "object" && value[0] !== null) {
        return (
          <div className="flex flex-col gap-2">
            {value.map((obj, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-100 bg-gray-50 p-2 flex flex-col gap-1"
              >
                {Object.entries(obj)
                  .filter(([k]) => !k.startsWith("$") && !HIDDEN_KEYS.has(k))
                  .map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-xs">
                    <span className="text-gray-500 shrink-0">
                      {labelFor(k)}:
                    </span>
                    <span className="text-gray-800 break-all">
                      {renderValue(k, v)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      }
      return value.join(", ");
    }

    if (typeof value === "object") {
      return (
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-2 flex flex-col gap-1">
          {Object.entries(value)
            .filter(([k]) => !k.startsWith("$") && !HIDDEN_KEYS.has(k))
            .map(([k, v]) => (
            <div key={k} className="flex gap-2 text-xs">
              <span className="text-gray-500 shrink-0">{labelFor(k)}:</span>
              <span className="text-gray-800 break-all">
                {renderValue(k, v)}
              </span>
            </div>
          ))}
        </div>
      );
    }

    return String(value);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-[560px] text-right max-h-[85vh] overflow-y-auto"
        dir="rtl"
        closePosition="left-4 top-4"
      >
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="text-lg text-right" dir="rtl">
            פרטי רשומת לוג
          </DialogTitle>
          <DialogDescription className="text-right" dir="rtl">
            {entry?.action}
          </DialogDescription>
        </DialogHeader>

        {/* The log entry's own metadata. */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm bg-gray-50 rounded-xl p-3 border border-gray-100">
          <Field label="מבצע הפעולה" value={entry?.user} />
          <Field label="סוג פעולה" value={entry?.type} />
          <Field
            label="סטטוס"
            value={
              entry?.status === "ok"
                ? "תקין"
                : entry?.status === "warn"
                  ? "חריג"
                  : "אסור"
            }
          />
          <Field label="תאריך ושעה" value={entry?.fullDateTime} />
        </div>

        {/* The referenced entity record, if any. */}
        <div className="mt-1">
          <p className="text-sm font-semibold text-gray-800 mb-2">
            רשומה מקושרת
            {entity && (
              <span className="text-gray-500 font-normal">
                {" "}
                — {ENTITY_LABELS[entity] || entity}
              </span>
            )}
          </p>

          {!record && canFetchEntity && recordLoading && (
            <div className="py-6 text-center text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin inline-block" />
            </div>
          )}

          {!record && !recordLoading && (
            <p className="text-sm text-gray-400">
              {canFetchEntity
                ? "הרשומה אינה זמינה עוד (ייתכן שנמחקה)."
                : "לפעולה זו אין רשומת נתונים מקושרת."}
            </p>
          )}

          {record && (
            <div className="flex flex-col divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
              {Object.entries(record)
                .filter(([k]) => !k.startsWith("$") && !HIDDEN_KEYS.has(k))
                .map(([k, v]) => (
                  <div
                    key={k}
                    className="grid grid-cols-[9rem_1fr] gap-3 px-3 py-2 text-sm odd:bg-white even:bg-gray-50/50"
                  >
                    <span className="text-gray-500">{labelFor(k)}</span>
                    <span className="text-gray-800 break-all">
                      {renderValue(k, v)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-gray-800 font-medium">{value || "—"}</span>
    </div>
  );
}

export default function LogsTab() {
  const [logFilters, setLogFilters] = useState({
    search: "",
    date: "",
    type: "all",
  });
  const [page, setPage] = useState(1);
  const [selectedEntry, setSelectedEntry] = useState(null);

  const { data: rawLogs = [], isLoading } = useQuery({
    queryKey: ["activity-logs"],
    // Newest first, with a generous cap so pagination can reach all rows.
    queryFn: () => base44.entities.ActivityLog.list("-created_date", 1000),
    staleTime: 1000 * 30,
  });

  const logTypeOptions = LOG_TYPE_OPTIONS;

  const statusColors = {
    ok: "bg-emerald-500",
    warn: "bg-amber-400",
    error: "bg-rose-500",
  };

  // Newest first — the log's most recent change at the top.
  const logEntries = useMemo(
    () => rawLogs.map(toEntry).sort((a, b) => b.sortMs - a.sortMs),
    [rawLogs],
  );

  const filteredLogs = useMemo(() => {
    return logEntries.filter((entry) => {
      const term = logFilters.search.toLowerCase();
      const matchesSearch =
        !term ||
        entry.action.toLowerCase().includes(term) ||
        entry.user.toLowerCase().includes(term);
      const matchesDate = !logFilters.date || entry.date === logFilters.date;
      const matchesType =
        logFilters.type === "all" || entry.type === logFilters.type;
      return matchesSearch && matchesDate && matchesType;
    });
  }, [logEntries, logFilters]);

  // Reset to the first page whenever the filters change so the user isn't
  // stranded on a now-empty page.
  useEffect(() => {
    setPage(1);
  }, [logFilters]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleLogs = filteredLogs.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const rangeStart =
    filteredLogs.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = (safePage - 1) * PAGE_SIZE + visibleLogs.length;

  return (
    <div className="space-y-3 md:space-y-4 overflow-y-auto">
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-800">פילטרים</p>
            <p className="text-xs text-gray-500">חיפוש, תאריכים וסוג פעולה</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-emerald-600">
            <Circle className="w-2.5 h-2.5 fill-emerald-500 text-emerald-500" />{" "}
            לוגים עדכניים
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3" dir="rtl">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="חיפוש טקסט חופשי"
              value={logFilters.search}
              onChange={(e) =>
                setLogFilters((prev) => ({
                  ...prev,
                  search: e.target.value,
                }))
              }
              className="pr-9 rounded-xl"
            />
          </div>
          <div className="relative">
            <CalendarDays className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="date"
              value={logFilters.date}
              onChange={(e) =>
                setLogFilters((prev) => ({
                  ...prev,
                  date: e.target.value,
                }))
              }
              className="pr-9 rounded-xl"
            />
          </div>
          <Select
            value={logFilters.type}
            onValueChange={(val) =>
              setLogFilters((prev) => ({ ...prev, type: val }))
            }
          >
            <SelectTrigger className="rounded-xl">
              <SelectValue placeholder="בחר סוג פעולה" />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="all">הכל</SelectItem>
              {logTypeOptions.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 font-semibold">סטטוס</th>
                <th className="px-4 py-3 font-semibold">משתמש</th>
                <th className="px-4 py-3 font-semibold">פעולה</th>
                <th className="px-4 py-3 font-semibold">תאריך</th>
                <th className="px-4 py-3 font-semibold">שעה</th>
                <th className="px-4 py-3 font-semibold">סוג פעולה</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-gray-400"
                  >
                    <Loader2 className="w-5 h-5 animate-spin inline-block" />
                  </td>
                </tr>
              )}
              {!isLoading && filteredLogs.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-sm text-gray-400"
                  >
                    אין רשומות לוג להצגה
                  </td>
                </tr>
              )}
              {!isLoading &&
                visibleLogs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedEntry(log)}
                    className="text-sm hover:bg-blue-50/60 cursor-pointer transition-colors"
                    title="לחצו לצפייה בפרטים מלאים"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-2 text-xs font-semibold ${log.status === "ok" ? "text-emerald-600" : log.status === "warn" ? "text-amber-600" : "text-rose-600"}`}
                      >
                        <span
                          className={`w-3 h-3 rounded-full ${statusColors[log.status]}`}
                        />
                        {log.status === "ok"
                          ? "תקין"
                          : log.status === "warn"
                            ? "חריג"
                            : "אסור"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-800">
                      {log.user}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{log.action}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {log.displayDate}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{log.time}</td>
                    <td className="px-4 py-3 text-gray-600">{log.type}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-500 flex items-center justify-between px-6 gap-3">
          <span>
            מציג {rangeStart}–{rangeEnd} מתוך {filteredLogs.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronRight className="w-4 h-4" /> הקודם
            </Button>
            <span className="tabular-nums">
              עמוד {safePage} מתוך {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              הבא <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <LogDetailModal
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
      />
    </div>
  );
}
