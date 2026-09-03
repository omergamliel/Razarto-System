import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { format, addDays, subMonths } from "date-fns";
import { distributeShifts } from "../calendar/shiftDistributionAlgorithm";
import {
  createAssignmentForShift,
  resolveOwnerId,
  syncAssignmentOwner,
  WHATSAPP_TEMPLATES,
} from "../calendar/whatsappTemplates";
import { useHolidays } from "../calendar/useHolidays";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Menu,
  Search,
  Filter,
  MoreVertical,
  Edit2,
  Trash2,
  ArrowLeftRight,
  ArrowLeft,
  Shield,
  UserX,
  UserPlus,
  AlertTriangle,
  Archive,
  Check,
  Send,
  CheckCircle2,
  Palette,
  HelpCircle,
  ChevronUp,
  ChevronDown,
  Circle,
  Plus,
  CalendarDays,
  Globe,
  Scale,
  Loader2,
  FlaskConical,
  XCircle,
  Download,
  Tag,
  Users,
  Star,
  UserMinus,
  Ban,
  MessageSquare,
  RotateCcw,
  Eye,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44, logActivity } from "@/api/base44Client";
import {
  isActiveGroupMember as isActiveGroupMemberRule,
  activeMemberSerialIdOnDate,
  todayKey,
} from "@/lib/utils";
import { VIEWER_MODE_KEY } from "@/hooks/useAuthorizedPerson";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { runPureTests, runLiveTests } from "@/lib/testing/testRunner";
import { exportAllData } from "@/lib/testing/exportData";
import FaqManager from "@/components/admin/FaqManager";
import ThemesTab from "@/components/admin/ThemesTab";
import LogsTab from "@/components/admin/LogsTab";
import {
  LOG_TYPE_OPTIONS,
  DEFAULT_GROUP_SYMBOLS,
} from "@/components/admin/adminConstants";

// A native <input type="date"> keeps the OS/browser date picker (calendar
// icon, click-to-pick, keyboard entry) — only its DISPLAYED format is
// locale-dependent, which is what made it show up as mm/dd/yyyy for some
// users. Setting lang="en-GB" on the input forces the dd/mm/yyyy display
// Israeli users expect, in every Chromium/Firefox browser, while .value
// keeps emitting/accepting the same 'yyyy-MM-dd' string as before.
// Display an ISO 'yyyy-MM-dd' string as dd/MM/yyyy (the Israeli format), without
// touching the underlying value. Returns the input unchanged if it isn't ISO.
function formatILDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "";
}

function DateInputIL({ value, onChange, className = "" }) {
  return (
    <Input
      type="date"
      lang="en-GB"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      dir="ltr"
      className={className}
    />
  );
}

// A user picker like the "החלפת משתמש למשמרת" dropdown, but with type-to-filter:
// the trigger doubles as a search box (filters by name/email), and clicking a
// row selects that user (value = serial_id). `excludeId` hides one user (so the
// "from"/"to" pair can't pick the same person).
function UserComboBox({
  value,
  onChange,
  users,
  placeholder = "בחר משתמש",
  excludeId,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selected = users.find((u) => Number(u.serial_id) === Number(value));
  const term = query.trim().toLowerCase();
  const filtered = users.filter(
    (u) =>
      Number(u.serial_id) !== Number(excludeId) &&
      (term === "" ||
        u.full_name?.toLowerCase().includes(term) ||
        u.email?.toLowerCase().includes(term)),
  );

  return (
    <div className="relative" ref={wrapRef} dir="rtl">
      <Input
        value={open ? query : selected?.full_name || ""}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        className="rounded-xl"
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-center text-sm text-gray-400">
              לא נמצאו משתמשים
            </p>
          ) : (
            filtered.map((u) => (
              <button
                key={u.serial_id}
                type="button"
                onClick={() => {
                  onChange(u.serial_id);
                  setOpen(false);
                  setQuery("");
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm hover:bg-gray-50 ${
                  Number(u.serial_id) === Number(value) ? "bg-blue-50" : ""
                }`}
              >
                <span className="truncate text-gray-800">{u.full_name}</span>
                {u.department && (
                  <span className="shrink-0 text-xs text-gray-400">
                    {u.department}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Does an error look like a rate-limit (429 / "rate limit")? Only those are
// worth retrying — a validation error should fail fast, not spin 3 times.
const isRateLimitError = (e) => {
  const status = e?.status ?? e?.response?.status ?? e?.code;
  if (status === 429) return true;
  return /rate limit|too many requests|429/i.test(e?.message || "");
};

// Run an array of thunks (each returns a promise) in small concurrent batches
// with a pause between them, so a bulk operation over hundreds of rows stays
// under the base44 write rate limit. Each task is retried with exponential
// backoff when it hits a rate limit, so a brief spike self-heals instead of
// aborting the whole migration. Tuned conservatively — this is a one-time admin
// routine, so throughput matters far less than not tripping the limiter.
async function runThrottled(
  tasks,
  { batchSize = 3, delayMs = 700, maxRetries = 6 } = {},
) {
  const runOne = async (thunk) => {
    let attempt = 0;
    for (;;) {
      try {
        return await thunk();
      } catch (e) {
        if (!isRateLimitError(e) || attempt >= maxRetries) throw e;
        attempt += 1;
        // Exponential backoff, capped at 15s: 1s, 2s, 4s, 8s, 15s, 15s.
        await sleep(Math.min(15000, 1000 * 2 ** (attempt - 1)));
      }
    }
  };

  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    await Promise.all(batch.map(runOne));
    if (i + batchSize < tasks.length) await sleep(delayMs);
  }
}

export default function AdminSettingsModal({ isOpen, onClose }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDepartments, setSelectedDepartments] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("users");
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [systemStatus, setSystemStatus] = useState(true);
  // "אילוצים" tab: K = monthly constraint threshold. Users may set unlimited
  // constraints; crossing K in a single month signals managers.
  const [considerationMax, setConsiderationMax] = useState("5");
  const [systemSettings, setSystemSettings] = useState({
    // הטקסטים בפועל שמוצגים תחת הלוגו ב-CalendarHeader.jsx
    title: "מערכת לניהול משמרות",
    subtitle: "צפייה במשמרות | ביצוע החלפות מסודרות",
    keywords: "Razarto, משמרות, החלפות",
    offlineMessage: "המערכת כרגע בתחזוקה מתוכננת. חזרו בעוד מספר דקות.",
  });
  const [supportSettings, setSupportSettings] = useState({
    // ה-embed בפועל ב-HelpSupportModal.jsx (מזהה סרטון YouTube)
    videoUrl: "https://youtu.be/9u12tJQ1KF4",
    // מספרי הוואטסאפ האמיתיים שמוזמנים בפועל מתוך HelpSupportModal.jsx
    permissionsPhone: "+972 54-688-1831",
    issuesPhone: "+972 53-622-1840",
  });
  // Admin-editable WhatsApp message templates (one string per request type),
  // seeded from the built-in defaults and hydrated from the AppSettings row
  // setting_key:"whatsapp_templates" on open. See the "הודעות וואטסאפ" tab.
  const [whatsappTemplates, setWhatsappTemplatesState] = useState(() =>
    Object.fromEntries(
      Object.entries(WHATSAPP_TEMPLATES).map(([key, def]) => [
        key,
        def.default,
      ]),
    ),
  );
  // --- MODAL STATES ---
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [addUserStep, setAddUserStep] = useState("form"); // 'form' or 'success'
  const [addedUserData, setAddedUserData] = useState(null); // Stores the newly added user for the invite

  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [isPermissionsOpen, setIsPermissionsOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // --- DATA STATES ---
  const [newUser, setNewUser] = useState({
    full_name: "",
    department: "",
    email: "",
    permissions: "RR",
    sign: "",
  });
  const [editingUser, setEditingUser] = useState(null);
  const [permissionUser, setPermissionUser] = useState(null);
  const [selectedPermission, setSelectedPermission] = useState("");
  const [isSignOpen, setIsSignOpen] = useState(false);
  const [signUser, setSignUser] = useState(null);
  const [signValue, setSignValue] = useState("");
  const [userToDelete, setUserToDelete] = useState(null);

  // --- Groups tab ("ניהול קבוצות") ---
  // Which group's "add members" dialog is open (the symbol string, or null),
  // and the set of AuthorizedPerson ids selected to add to it.
  const [groupPickerSymbol, setGroupPickerSymbol] = useState(null);
  const [groupPickerSelected, setGroupPickerSelected] = useState([]);
  const [groupPickerSearch, setGroupPickerSearch] = useState("");
  // Groups tab search (filters by group name or member name/email), and the
  // group pending a delete confirmation.
  const [groupSearch, setGroupSearch] = useState("");
  const [groupToDelete, setGroupToDelete] = useState(null);
  // Member pending a "remove from group" confirmation: { person, symbol } | null.
  const [memberToRemove, setMemberToRemove] = useState(null);
  // Add-group dialog (mirrors the "add members to group" dialog): open state and
  // the name being typed.
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  // Scheduled active-member switch dialog: which group symbol is open (or null),
  // the incoming member's serial_id, and the switch date ('yyyy-MM-dd'). From
  // that date on, the group's active member becomes the incoming member — both
  // in the calendar (the incoming member's shifts aren't flagged out-of-policy)
  // and in distribution (ownership switches over during the run).
  const [switchDialogSymbol, setSwitchDialogSymbol] = useState(null);
  const [switchTargetSerial, setSwitchTargetSerial] = useState("");
  const [switchDate, setSwitchDate] = useState("");
  // Scheduling mode in the dialog: "switch" (hand the group to another member)
  // or "deactivate" (from the date on, the group has no active member at all).
  const [switchMode, setSwitchMode] = useState("switch");

  // Archive Logic States
  const [isArchiveMode, setIsArchiveMode] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  // When on, the users table shows ONLY permissions="None" users (the archive);
  // when off, those users are hidden from the main list.
  const [showArchive, setShowArchive] = useState(false);

  // --- Fair shift distribution (tasks.txt #4) ---
  const [distributionRange, setDistributionRange] = useState({
    startDate: "",
    endDate: "",
  });
  const [distributionResult, setDistributionResult] = useState(null);
  const [distributionError, setDistributionError] = useState("");
  // When on (default), the fairness table is seeded with each group's shift
  // count from the 6 months BEFORE the range start, so a group that already
  // worked a lot recently is deprioritized. Counted by group (folded onto the
  // representative), not by individual member. Off = fairness is decided purely
  // within the selected range.
  const [considerHistory, setConsiderHistory] = useState(true);
  // Grace period (days) an incoming member is left free of shifts after a
  // scheduled group switch — honored by distribution. Persisted as the
  // AppSettings "switch_grace" row; defaults to 30.
  const [switchGraceDays, setSwitchGraceDays] = useState("30");

  // --- Delete shifts in a date range ---
  const [deleteShiftsRange, setDeleteShiftsRange] = useState({
    startDate: "",
    endDate: "",
  });
  const [deleteShiftsError, setDeleteShiftsError] = useState("");
  const [isDeleteShiftsConfirmOpen, setIsDeleteShiftsConfirmOpen] =
    useState(false);

  // --- Replace one user's shifts with another user's, in a date range ---
  const [replaceShiftsForm, setReplaceShiftsForm] = useState({
    startDate: "",
    endDate: "",
    fromUserId: "",
    toUserId: "",
  });
  const [replaceShiftsError, setReplaceShiftsError] = useState("");
  const [isReplaceShiftsConfirmOpen, setIsReplaceShiftsConfirmOpen] =
    useState(false);
  // Set when a group's active member is swapped and the outgoing member still
  // owns future shifts — drives the "migrate future shifts?" confirm dialog.
  // Shape: { previousPerson, newPerson, shiftIds }.
  const [pendingShiftMigration, setPendingShiftMigration] = useState(null);

  // --- System test suite (src/lib/testing) ---
  const [testResults, setTestResults] = useState(null);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [showTestExportGate, setShowTestExportGate] = useState(false);

  const queryClient = useQueryClient();

  // --- HELPER: Permission Colors ---
  const getPermissionStyle = (perm) => {
    switch (perm) {
      case "RR":
        return { bg: "#fde4cf", text: "#5d3a1a", border: "#e8cdb3" };
      case "Viewer":
        return { bg: "#e5e7eb", text: "#334155", border: "#cbd5e1" };
      case "None":
        return { bg: "#fecaca", text: "#7f1d1d", border: "#fca5a5" };
      case "Manager":
        return { bg: "#dfe7fd", text: "#1e40af", border: "#bfdbfe" }; // Updated Color
      case "Admin":
        return { bg: "#b9fbc0", text: "#1e5e24", border: "#a3e5aa" };
      default:
        return { bg: "#f3f4f6", text: "#4b5563", border: "#e5e7eb" };
    }
  };

  // --- HELPER: WhatsApp Invite ---
  const handleSendInvite = (user) => {
    if (!user) return;
    const message = `היי *${user.full_name}* \nהוזמנת להצטרף למערכת Razarto\nיש להיכנס לקישור ולהתחבר באמצעות המייל האישי.\nקישור: https://razar-toran-b555aef5.base44.app`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
  };

  // --- QUERIES ---
  const { data: authorizedPeople = [], isLoading: isLoadingPeople } = useQuery({
    queryKey: ["authorized-people"],
    queryFn: () => base44.entities.AuthorizedPerson.list(),
    enabled: isOpen,
  });

  // Connectivity. A person is "connected" once they've completed onboarding,
  // which mirrors {serial_id, connected:true} into ConnectionStatus (see the
  // sync effect in ShiftCalendar). We read connectivity from ConnectionStatus
  // rather than the User entity because User's read RLS is admin-only — an
  // app-Manager (platform "user") can't list other users' rows, so a
  // User-based column would show everyone as red for them. ConnectionStatus is
  // readable by any authorized user and exposes ONLY serial_id + connected (no
  // emails/names/roles), so the column reflects reality for Managers too.
  const { data: connectionStatuses = [] } = useQuery({
    queryKey: ["connection-statuses"],
    queryFn: () => base44.entities.ConnectionStatus.list(),
    enabled: isOpen,
  });
  const authorizedSerialIds = useMemo(() => {
    const set = new Set();
    connectionStatuses.forEach((c) => {
      if (c.connected && c.serial_id != null) set.add(Number(c.serial_id));
    });
    return set;
  }, [connectionStatuses]);
  const isPersonConnected = useCallback(
    (person) =>
      person.serial_id != null &&
      authorizedSerialIds.has(Number(person.serial_id)),
    [authorizedSerialIds],
  );

  // One-time legacy data migration: the "View" permission was replaced by
  // "None". Any rows still stored as "View" are bulk-updated to "None" the
  // first time an admin (the only role that can update AuthorizedPerson) opens
  // this modal. Idempotent — once migrated no rows match, so it never runs
  // again; the guard ref just avoids re-firing while the update is in flight.
  const legacyPermMigrationRan = useRef(false);
  useEffect(() => {
    if (!isOpen || legacyPermMigrationRan.current) return;
    const legacy = authorizedPeople.filter((p) => p.permissions === "View");
    if (legacy.length === 0) return;
    legacyPermMigrationRan.current = true;
    (async () => {
      try {
        await Promise.all(
          legacy.map((p) =>
            base44.entities.AuthorizedPerson.update(p.id, {
              permissions: "None",
            }),
          ),
        );
        queryClient.invalidateQueries(["authorized-people"]);
      } catch (e) {
        legacyPermMigrationRan.current = false; // allow retry on next open
        console.error("Legacy 'View' → 'None' migration failed:", e);
      }
    })();
  }, [isOpen, authorizedPeople, queryClient]);

  // Group "active member" records (ShiftGroup entity): one row per group symbol
  // that currently has an active member — { symbol, serial_id (active member's
  // serial_id), active }. Drives the "ניהול קבוצות" tab and gates shift
  // distribution (only active members are assigned shifts).
  const { data: shiftGroups = [] } = useQuery({
    queryKey: ["shift-groups"],
    queryFn: () => base44.entities.ShiftGroup.list(),
    enabled: isOpen,
  });

  // symbol -> the ShiftGroup row for that group (holds its active member, if
  // any). Each ShiftGroup row now IS a group definition.
  const activeGroupBySymbol = useMemo(() => {
    const map = new Map();
    shiftGroups.forEach((group) => {
      if (group.symbol) map.set(group.symbol, group);
    });
    return map;
  }, [shiftGroups]);

  // The live list of groups: every ShiftGroup symbol, plus any symbol already
  // referenced by a user's `sign` (so pre-existing groups without a row still
  // appear). Sorted with Hebrew collation. This replaces the old fixed list.
  const groupSymbols = useMemo(() => {
    const set = new Set();
    shiftGroups.forEach((group) => group.symbol && set.add(group.symbol));
    authorizedPeople.forEach((p) => p.sign && set.add(p.sign));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "he"));
  }, [shiftGroups, authorizedPeople]);

  // symbol -> that group's members (people whose `sign` is the symbol),
  // sorted by name; drives the "ניהול קבוצות" tab.
  const membersBySymbol = useMemo(() => {
    const map = new Map();
    authorizedPeople.forEach((p) => {
      if (!p.sign) return;
      if (!map.has(p.sign)) map.set(p.sign, []);
      map.get(p.sign).push(p);
    });
    map.forEach((arr) =>
      arr.sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "")),
    );
    return map;
  }, [authorizedPeople]);

  // Groups tab search: keep a group when the term matches its name (symbol) OR
  // any of its members' name/email — so admins can find a group by who's in it.
  const filteredGroupSymbols = useMemo(() => {
    const term = groupSearch.trim().toLowerCase();
    if (!term) return groupSymbols;
    return groupSymbols.filter((symbol) => {
      if (symbol.toLowerCase().includes(term)) return true;
      const members = membersBySymbol.get(symbol) || [];
      return members.some(
        (m) =>
          (m.full_name || "").toLowerCase().includes(term) ||
          (m.email || "").toLowerCase().includes(term),
      );
    });
  }, [groupSymbols, membersBySymbol, groupSearch]);

  // Add-group dialog derived state + submit. Inline validation (empty /
  // duplicate) mirrors the "add members to group" dialog; the dialog only
  // closes on a successful create.
  const trimmedNewGroup = newGroupName.trim();
  const newGroupDuplicate =
    trimmedNewGroup !== "" &&
    groupSymbols.some((s) => s.toLowerCase() === trimmedNewGroup.toLowerCase());
  const submitAddGroup = () => {
    if (!trimmedNewGroup || newGroupDuplicate || addGroupMutation.isPending)
      return;
    addGroupMutation.mutate(trimmedNewGroup, {
      onSuccess: () => {
        setAddGroupOpen(false);
        setNewGroupName("");
      },
    });
  };

  // Whether a person is the *active* member of their group — i.e. their group's
  // ShiftGroup row is marked active and its active-member email is theirs.
  // Only the active member of each group is assigned shifts by distribution, so
  // the users tab highlights their symbol to make that visible at a glance.
  // Delegated to the shared rule (src/lib/utils.js) so the star shown here can't
  // drift from the runtime gate (canTakeShifts) or the assignment dropdowns.
  const isActiveGroupMember = useCallback(
    (person) => isActiveGroupMemberRule(person, shiftGroups),
    [shiftGroups],
  );

  // Candidates for the "add members to group" dialog: everyone not already in
  // the open group, filtered by the dialog's search box.
  const groupPickerCandidates = useMemo(() => {
    if (!groupPickerSymbol) return [];
    const term = groupPickerSearch.trim().toLowerCase();
    return authorizedPeople.filter(
      (p) =>
        p.sign !== groupPickerSymbol &&
        (term === "" ||
          p.full_name?.toLowerCase().includes(term) ||
          p.email?.toLowerCase().includes(term)),
    );
  }, [authorizedPeople, groupPickerSymbol, groupPickerSearch]);

  // Shares the same ['app-settings'] cache/entity as CalendarHeader.jsx's
  // logo upload, so uploading it from either place updates the other.
  const { data: appSettings = [] } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => base44.entities.AppSettings.list(),
    enabled: isOpen,
  });
  const logoUrl =
    appSettings.find((s) => s.setting_key === "logo")?.logo_url || "";
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const updateLogoMutation = useMutation({
    mutationFn: async (url) => {
      const existing = appSettings.find((s) => s.setting_key === "logo");
      if (existing) {
        return base44.entities.AppSettings.update(existing.id, {
          logo_url: url,
        });
      }
      return base44.entities.AppSettings.create({
        setting_key: "logo",
        logo_url: url,
      });
    },
    onSuccess: () => {
      logActivity({
        action: "עדכון לוגו המערכת",
        type: "עדכון מערכת",
        entity: "AppSettings",
      });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("הלוגו עודכן בהצלחה");
    },
    onError: () => toast.error("שגיאה בהעלאת הלוגו"),
  });

  const handleLogoFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingLogo(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      await updateLogoMutation.mutateAsync(file_url);
    } catch (error) {
      toast.error("שגיאה בהעלאת הלוגו");
    } finally {
      setIsUploadingLogo(false);
      e.target.value = "";
    }
  };

  // --- SYSTEM / SUPPORT SETTINGS PERSISTENCE (AppSettings) ---
  // The "הגדרות" and "תמיכה" tabs used to be local-state only — edits never
  // left the component. Each tab is now persisted as ONE AppSettings row keyed
  // by setting_key ('system' / 'support'), storing a JSON blob in `value`,
  // sharing the same ['app-settings'] cache/entity as the logo above.
  const upsertSetting = async (key, valueObj) => {
    const existing = appSettings.find((s) => s.setting_key === key);
    const value = JSON.stringify(valueObj);
    if (existing) {
      return base44.entities.AppSettings.update(existing.id, { value });
    }
    return base44.entities.AppSettings.create({ setting_key: key, value });
  };

  // --- READ-ONLY VIEWER MODE (global "RR ⇒ viewer" switch) ---
  // Persisted as its own AppSettings row so it takes effect app-wide the moment
  // it's toggled — no separate "save" press, unlike the system/support tabs.
  // The overlay is read via useViewerMode()/isViewerFor() elsewhere; RR users
  // are treated as read-only viewers while it's on, WITHOUT their stored
  // permissions changing.
  const viewerModeOn = useMemo(() => {
    const row = appSettings.find((s) => s.setting_key === VIEWER_MODE_KEY);
    if (!row?.value) return false;
    try {
      return Boolean(JSON.parse(row.value).rrAsViewer);
    } catch {
      return false;
    }
  }, [appSettings]);

  const toggleViewerModeMutation = useMutation({
    mutationFn: (next) => upsertSetting(VIEWER_MODE_KEY, { rrAsViewer: next }),
    onSuccess: (_data, next) => {
      logActivity({
        action: next
          ? "הפעלת מצב צפייה בלבד לכל משתמשי RR"
          : "כיבוי מצב צפייה בלבד",
        type: "עדכון מערכת",
        entity: "AppSettings",
      });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success(
        next
          ? "מצב צפייה בלבד הופעל — משתמשי RR לא יכולים לבצע שינויים"
          : "מצב צפייה בלבד כובה",
      );
    },
    onError: () => toast.error("שגיאה בעדכון מצב צפייה בלבד"),
  });

  // Hydrate the tab state from saved rows once per modal open, WITHOUT
  // clobbering in-progress edits (the ref guards against re-running on every
  // background refetch of the shared cache).
  const settingsHydratedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      settingsHydratedRef.current = false;
      return;
    }
    if (settingsHydratedRef.current || appSettings.length === 0) return;

    const systemRow = appSettings.find((s) => s.setting_key === "system");
    if (systemRow?.value) {
      try {
        const { systemStatus: savedStatus, ...rest } = JSON.parse(
          systemRow.value,
        );
        setSystemSettings((prev) => ({ ...prev, ...rest }));
        if (typeof savedStatus === "boolean") setSystemStatus(savedStatus);
      } catch (error) {
        console.error("Failed to parse saved system settings:", error);
      }
    }

    const supportRow = appSettings.find((s) => s.setting_key === "support");
    if (supportRow?.value) {
      try {
        setSupportSettings((prev) => ({
          ...prev,
          ...JSON.parse(supportRow.value),
        }));
      } catch (error) {
        console.error("Failed to parse saved support settings:", error);
      }
    }

    const whatsappRow = appSettings.find(
      (s) => s.setting_key === "whatsapp_templates",
    );
    if (whatsappRow?.value) {
      try {
        const saved = JSON.parse(whatsappRow.value);
        // Only keep known template keys; a missing key keeps its default so a
        // newly added template type still shows its built-in text.
        setWhatsappTemplatesState((prev) => {
          const next = { ...prev };
          Object.keys(WHATSAPP_TEMPLATES).forEach((key) => {
            if (typeof saved?.[key] === "string") next[key] = saved[key];
          });
          return next;
        });
      } catch (error) {
        console.error("Failed to parse saved WhatsApp templates:", error);
      }
    }

    const considerationRow = appSettings.find(
      (s) => s.setting_key === "consideration",
    );
    if (considerationRow?.value) {
      try {
        const saved = JSON.parse(considerationRow.value);
        if (saved?.maxDates != null) setConsiderationMax(String(saved.maxDates));
      } catch (error) {
        console.error("Failed to parse saved consideration settings:", error);
      }
    }

    const switchGraceRow = appSettings.find(
      (s) => s.setting_key === "switch_grace",
    );
    if (switchGraceRow?.value) {
      try {
        const saved = JSON.parse(switchGraceRow.value);
        if (saved?.days != null) setSwitchGraceDays(String(saved.days));
      } catch (error) {
        console.error("Failed to parse saved switch-grace settings:", error);
      }
    }

    settingsHydratedRef.current = true;
  }, [isOpen, appSettings]);

  const saveConsiderationMutation = useMutation({
    mutationFn: () => {
      const n = Math.floor(Number(considerationMax));
      if (!Number.isFinite(n) || n < 1) {
        throw new Error("יש להזין מספר שלם חיובי");
      }
      return upsertSetting("consideration", { maxDates: n });
    },
    onSuccess: () => {
      logActivity({
        action: `עדכון סף האילוצים החודשי ל-${Math.floor(Number(considerationMax))}`,
        type: "עדכון מערכת",
        entity: "AppSettings",
      });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("סף האילוצים נשמר");
    },
    onError: (e) =>
      toast.error(e?.message || "שגיאה בשמירת סף האילוצים"),
  });

  const saveSwitchGraceMutation = useMutation({
    mutationFn: () => {
      const n = Math.floor(Number(switchGraceDays));
      if (!Number.isFinite(n) || n < 0) {
        throw new Error("יש להזין מספר שלם (0 ומעלה)");
      }
      return upsertSetting("switch_grace", { days: n });
    },
    onSuccess: () => {
      logActivity({
        action: `עדכון תקופת החסד להחלפה מתוזמנת ל-${Math.floor(Number(switchGraceDays))} ימים`,
        type: "עדכון מערכת",
        entity: "AppSettings",
      });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("תקופת החסד נשמרה");
    },
    onError: (e) => toast.error(e?.message || "שגיאה בשמירת תקופת החסד"),
  });

  const saveSystemSettingsMutation = useMutation({
    mutationFn: () =>
      upsertSetting("system", { ...systemSettings, systemStatus }),
    onSuccess: () => {
      logActivity({
        action: "שמירת הגדרות מערכת",
        type: "עדכון מערכת",
        entity: "AppSettings",
      });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("ההגדרות נשמרו בהצלחה");
    },
    onError: () => toast.error("שגיאה בשמירת ההגדרות"),
  });

  const saveSupportSettingsMutation = useMutation({
    mutationFn: () => upsertSetting("support", supportSettings),
    onSuccess: () => {
      logActivity({
        action: "שמירת הגדרות תמיכה",
        type: "עדכון מערכת",
        entity: "AppSettings",
      });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("הגדרות התמיכה נשמרו בהצלחה");
    },
    onError: () => toast.error("שגיאה בשמירת הגדרות התמיכה"),
  });

  const saveWhatsappTemplatesMutation = useMutation({
    mutationFn: () => upsertSetting("whatsapp_templates", whatsappTemplates),
    onSuccess: () => {
      logActivity({
        action: "עדכון תבניות הודעות וואטסאפ",
        type: "עדכון מערכת",
        entity: "AppSettings",
      });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("הודעות הוואטסאפ נשמרו בהצלחה");
    },
    onError: () => toast.error("שגיאה בשמירת הודעות הוואטסאפ"),
  });

  // Fetches all shifts (shares the ['shifts'] cache with the rest of the app),
  // but shiftDistributionAlgorithm only ever looks at the ones that fall
  // inside the chosen [startDate, endDate] range — it has no dependency on
  // shift history from before the range.
  const { data: rawShiftsForDistribution = [] } = useQuery({
    queryKey: ["shifts"],
    queryFn: () => base44.entities.Shift.list(),
    enabled: isOpen,
  });

  // Ownership lives in the base "assignment" ShiftCoverage row (Phase 4). Join
  // each shift with its resolved owner into an `original_user_id`-shaped field
  // so the owner-based filters below (and the distribution algorithm, which
  // reads s.original_user_id) keep working without a schema field.
  const { data: allCoveragesForOwnership = [] } = useQuery({
    queryKey: ["coverages"],
    queryFn: () => base44.entities.ShiftCoverage.list(),
    enabled: isOpen,
  });
  const allShiftsForDistribution = useMemo(
    () =>
      rawShiftsForDistribution.map((s) => ({
        ...s,
        original_user_id: resolveOwnerId(s, allCoveragesForOwnership),
      })),
    [rawShiftsForDistribution, allCoveragesForOwnership],
  );

  const distributionYears = useMemo(() => {
    const { startDate, endDate } = distributionRange;
    if (!startDate || !endDate) return [];
    const startYear = new Date(startDate).getFullYear();
    const endYear = new Date(endDate).getFullYear();
    if (Number.isNaN(startYear) || Number.isNaN(endYear)) return [];
    const years = [];
    for (let y = startYear; y <= endYear; y++) years.push(y);
    return years;
  }, [distributionRange]);

  const { data: holidaysData } = useHolidays(distributionYears);
  const holidaysByDate = holidaysData?.labels || {};
  const cholHamoedDates = holidaysData?.cholHamoedDates || new Set();

  // --- MUTATIONS ---

  // 1. Create User
  const addUserMutation = useMutation({
    mutationFn: async (userData) => {
      const maxId = authorizedPeople.reduce(
        (max, person) =>
          (person.serial_id || 0) > max ? person.serial_id : max,
        0,
      );
      const created = await base44.entities.AuthorizedPerson.create({
        ...userData,
        serial_id: maxId + 1,
      });

      // Also provision the person as a platform User so they can actually
      // log in — AuthorizedPerson alone is just an in-app permissions
      // whitelist and is never synced to the platform's own Users table.
      try {
        await base44.users.inviteUser(
          userData.email,
          userData.permissions === "Admin" ? "admin" : "user",
        );
      } catch (inviteError) {
        console.error("Failed to invite user to platform:", inviteError);
        toast.error(
          "המשתמש נוסף למערכת אך שליחת ההזמנה להתחברות נכשלה. יש להזמין אותו ידנית.",
        );
      }

      return created;
    },
    onSuccess: (data) => {
      logActivity({
        action: `הוספת משתמש: ${data?.full_name || ""}`.trim(),
        type: "שינויים בהרשאות",
        entity: "AuthorizedPerson",
        entityId: data?.id,
      });
      queryClient.invalidateQueries(["authorized-people"]);
      // Instead of closing, switch to success step
      setAddedUserData(data);
      setAddUserStep("success");
      setNewUser({
        full_name: "",
        department: "",
        email: "",
        permissions: "RR",
        sign: "",
      }); // Reset form
    },
    onError: () => toast.error("שגיאה בהוספת המשתמש."),
  });

  // 2. Update User
  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      return await base44.entities.AuthorizedPerson.update(id, data);
    },
    onSuccess: (_data, variables) => {
      logActivity({
        action: "עדכון פרטי משתמש / הרשאות",
        type: "שינויים בהרשאות",
        entity: "AuthorizedPerson",
        entityId: variables?.id,
      });
      queryClient.invalidateQueries(["authorized-people"]);
      toast.success("הפרטים עודכנו בהצלחה!");
      setIsEditUserOpen(false);
      setIsPermissionsOpen(false);
      setIsSignOpen(false);
    },
    onError: () => toast.error("שגיאה בעדכון הפרטים."),
  });

  // 3. Delete User
  const deleteUserMutation = useMutation({
    mutationFn: async (id) => {
      return await base44.entities.AuthorizedPerson.delete(id);
    },
    onSuccess: (_data, id) => {
      logActivity({
        action: "מחיקת משתמש מהמערכת",
        type: "שינויים בהרשאות",
        entity: "AuthorizedPerson",
        entityId: id,
      });
      queryClient.invalidateQueries(["authorized-people"]);
      toast.success("המשתמש הוסר מהמערכת בהצלחה.");
      setIsDeleteOpen(false);
      setUserToDelete(null);
    },
    onError: () => toast.error("שגיאה במחיקת המשתמש."),
  });

  // 3b. Groups — set a group's active member. Only one member per group may be
  // active (or none): the group's single ShiftGroup row points its `serial_id`
  // at the active member's serial_id. Passing person=null (or clicking the
  // already-active member) clears the active member WITHOUT deleting the row —
  // the row is the group definition itself, so it must survive. The active
  // member must belong to the group already.
  const setActiveMemberMutation = useMutation({
    mutationFn: async ({ symbol, person }) => {
      const existing = activeGroupBySymbol.get(symbol);
      // The serial_id of the active member being replaced (if any), captured
      // before we overwrite the row, so onSuccess can offer to migrate their
      // shifts.
      const previousActiveSerialId =
        existing?.active && existing?.serial_id != null
          ? existing.serial_id
          : null;
      const clearing =
        !person ||
        (existing?.active &&
          Number(existing?.serial_id) === Number(person.serial_id));
      if (clearing) {
        if (existing) {
          await base44.entities.ShiftGroup.update(existing.id, {
            serial_id: null,
            active: false,
          });
        }
        return { previousActiveSerialId, cleared: true };
      }
      if (existing) {
        await base44.entities.ShiftGroup.update(existing.id, {
          serial_id: person.serial_id,
          active: true,
        });
      } else {
        // Group referenced only by members' `sign` and no row yet — create it.
        await base44.entities.ShiftGroup.create({
          symbol,
          serial_id: person.serial_id,
          active: true,
        });
      }
      return { previousActiveSerialId, cleared: false };
    },
    onSuccess: (result, { symbol, person }) => {
      logActivity({
        action: result?.cleared
          ? `ניקוי משתמש פעיל בקבוצה ${symbol}`
          : `עדכון משתמש פעיל בקבוצה ${symbol}`,
        type: "עדכון מערכת",
        entity: "ShiftGroup",
      });
      queryClient.invalidateQueries(["shift-groups"]);
      offerFutureShiftMigration(result, person);
    },
    onError: () => toast.error("שגיאה בעדכון המשתמש הפעיל בקבוצה."),
  });

  // When a group's active member is swapped for a different person, the shifts
  // the OUTGOING active member owns ahead of today keep being theirs even though
  // distribution now favours the newcomer. Rather than silently reassign them,
  // offer it: a confirm dialog shows "outgoing → incoming" and hands every
  // future shift of the outgoing member over to the incoming one on confirm.
  const migrateFutureShiftsMutation = useMutation({
    mutationFn: async ({ shiftIds, toUserId }) => {
      // Ownership lives in the base "assignment" coverage row (Phase 4) — repoint
      // it for each migrated shift. Fetch coverages once and pass them in so
      // syncAssignmentOwner can reuse the assignment row it already has. Throttled
      // to stay under the rate limit on large ranges.
      const coverages = await base44.entities.ShiftCoverage.list();
      await runThrottled(
        shiftIds.map(
          (id) => () => syncAssignmentOwner(id, Number(toUserId), coverages),
        ),
      );
      return shiftIds.length;
    },
    onSuccess: (count) => {
      logActivity({
        action: `העברת ${count} משמרות עתידיות למשתמש פעיל חדש`,
        type: "עדכון מערכת",
        entity: "ShiftCoverage",
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["coverages"]);
      setPendingShiftMigration(null);
      toast.success(`הועברו ${count} משמרות עתידיות למשתמש הפעיל החדש`);
    },
    onError: () => toast.error("העברת המשמרות העתידיות נכשלה. נסו שוב."),
  });

  const offerFutureShiftMigration = (result, person) => {
    const previousSerialId = result?.previousActiveSerialId;
    // Only when we replaced an existing, different active member with a real
    // newcomer — clearing the active member, or setting the first one, has
    // nothing to migrate.
    if (
      !result ||
      result.cleared ||
      !person ||
      previousSerialId == null ||
      Number(previousSerialId) === Number(person.serial_id)
    ) {
      return;
    }
    const previousPerson = authorizedPeople.find(
      (p) => Number(p.serial_id) === Number(previousSerialId),
    );
    if (!previousPerson) return;

    const todayStr = format(new Date(), "yyyy-MM-dd");
    const futureShifts = allShiftsForDistribution.filter(
      (s) =>
        Number(s.original_user_id) === Number(previousPerson.serial_id) &&
        s.start_date > todayStr,
    );
    if (futureShifts.length === 0) return;

    setPendingShiftMigration({
      previousPerson,
      newPerson: person,
      shiftIds: futureShifts.map((s) => s.id),
    });
  };

  // 3b-i. Groups — add a new group (a ShiftGroup row with just a symbol).
  const addGroupMutation = useMutation({
    mutationFn: async (symbol) => {
      const trimmed = (symbol || "").trim();
      if (!trimmed) throw new Error("empty");
      if (groupSymbols.includes(trimmed)) throw new Error("duplicate");
      await base44.entities.ShiftGroup.create({
        symbol: trimmed,
        active: false,
      });
    },
    onSuccess: (_data, symbol) => {
      logActivity({
        action: `הוספת קבוצה: ${(symbol || "").trim()}`,
        type: "עדכון מערכת",
        entity: "ShiftGroup",
      });
      queryClient.invalidateQueries(["shift-groups"]);
      toast.success("הקבוצה נוספה.");
    },
    onError: (err) => {
      if (err?.message === "duplicate") toast.error("קבוצה בשם זה כבר קיימת.");
      else if (err?.message === "empty") toast.error("יש להזין שם קבוצה.");
      else toast.error("שגיאה בהוספת הקבוצה.");
    },
  });

  // 3b-ii. Groups — remove a group entirely: delete its ShiftGroup row (if
  // any) and clear `sign` from every member so no user points at a dead group.
  const removeGroupMutation = useMutation({
    mutationFn: async (symbol) => {
      const seg = activeGroupBySymbol.get(symbol);
      if (seg) await base44.entities.ShiftGroup.delete(seg.id);
      const members = authorizedPeople.filter((p) => p.sign === symbol);
      await Promise.all(
        members.map((m) =>
          base44.entities.AuthorizedPerson.update(m.id, { sign: null }),
        ),
      );
    },
    onSuccess: (_data, symbol) => {
      logActivity({
        action: `הסרת קבוצה: ${symbol}`,
        type: "עדכון מערכת",
        entity: "ShiftGroup",
      });
      queryClient.invalidateQueries(["shift-groups"]);
      queryClient.invalidateQueries(["authorized-people"]);
      toast.success("הקבוצה הוסרה.");
      setGroupToDelete(null);
    },
    onError: () => toast.error("שגיאה בהסרת הקבוצה."),
  });

  // 3b-iii. Groups — one-click seed of the default 24 groups, for the empty
  // state. Only creates the ones that don't already exist.
  const seedDefaultGroupsMutation = useMutation({
    mutationFn: async () => {
      const missing = DEFAULT_GROUP_SYMBOLS.filter(
        (s) => !groupSymbols.includes(s),
      );
      await Promise.all(
        missing.map((s) =>
          base44.entities.ShiftGroup.create({ symbol: s, active: false }),
        ),
      );
    },
    onSuccess: () => {
      logActivity({
        action: "יצירת קבוצות ברירת המחדל",
        type: "עדכון מערכת",
        entity: "ShiftGroup",
      });
      queryClient.invalidateQueries(["shift-groups"]);
      toast.success("קבוצות ברירת המחדל נוצרו.");
    },
    onError: () => toast.error("שגיאה ביצירת קבוצות ברירת המחדל."),
  });

  // 3c. Groups — add one or more users to a group by setting their `sign` to
  // the group symbol (same effect as "עריכת קבוצה", in bulk).
  const addUsersToGroupMutation = useMutation({
    mutationFn: async ({ symbol, personIds }) => {
      await Promise.all(
        personIds.map((id) =>
          base44.entities.AuthorizedPerson.update(id, { sign: symbol }),
        ),
      );
    },
    onSuccess: (_data, { symbol, personIds }) => {
      logActivity({
        action: `הוספת ${personIds.length} משתמשים לקבוצה ${symbol}`,
        type: "עדכון מערכת",
        entity: "AuthorizedPerson",
      });
      queryClient.invalidateQueries(["authorized-people"]);
      toast.success(`נוספו ${personIds.length} משתמשים לקבוצה.`);
      setGroupPickerSymbol(null);
      setGroupPickerSelected([]);
      setGroupPickerSearch("");
    },
    onError: () => toast.error("שגיאה בהוספת משתמשים לקבוצה."),
  });

  // 3d. Groups — remove a user from their group (clear `sign`). If they were the
  // group's active member, clear just the active flag on the group's row (never
  // delete the row — it's the group definition itself).
  const removeFromGroupMutation = useMutation({
    mutationFn: async ({ person }) => {
      await base44.entities.AuthorizedPerson.update(person.id, { sign: null });
      const seg = person.sign ? activeGroupBySymbol.get(person.sign) : null;
      if (
        seg &&
        seg.active &&
        Number(seg.serial_id) === Number(person.serial_id)
      ) {
        await base44.entities.ShiftGroup.update(seg.id, {
          serial_id: null,
          active: false,
        });
      }
    },
    onSuccess: (_data, { person }) => {
      logActivity({
        action: `הסרת ${person?.full_name || "משתמש"} מקבוצה`,
        type: "עדכון מערכת",
        entity: "AuthorizedPerson",
        entityId: person?.id,
      });
      queryClient.invalidateQueries(["authorized-people"]);
      queryClient.invalidateQueries(["shift-groups"]);
      toast.success("המשתמש הוסר מהקבוצה.");
    },
    onError: () => toast.error("שגיאה בהסרת המשתמש מהקבוצה."),
  });

  // 3d. Groups — schedule (or cancel) a future active-member switch. The
  // group's ShiftGroup row keeps its current active member in `serial_id`; the
  // scheduled fields say "on this date, the active member becomes this other
  // member". The shared date-aware rule (activeMemberSerialIdOnDate) then makes
  // the calendar and distribution treat the incoming member as active from that
  // date on — no cron/commit step needed. Passing target=null clears it.
  const scheduleSwitchMutation = useMutation({
    mutationFn: async ({ symbol, targetSerialId, date, deactivate = false }) => {
      const existing = activeGroupBySymbol.get(symbol);
      // A deactivate schedule needs only a date (no incoming member); a switch
      // needs both a date and a target. Anything else clears the schedule.
      const clearing = !date || (!deactivate && targetSerialId == null);
      const payload = clearing
        ? {
            scheduled_switch_date: null,
            scheduled_switch_serial_id: null,
            scheduled_switch_deactivate: false,
          }
        : deactivate
        ? {
            scheduled_switch_date: date,
            scheduled_switch_serial_id: null,
            scheduled_switch_deactivate: true,
          }
        : {
            scheduled_switch_date: date,
            scheduled_switch_serial_id: Number(targetSerialId),
            scheduled_switch_deactivate: false,
          };
      if (existing) {
        await base44.entities.ShiftGroup.update(existing.id, payload);
      } else {
        // No row yet (group referenced only by members' `sign`) — create it.
        // There's no current active member to carry over, so leave that empty.
        await base44.entities.ShiftGroup.create({
          symbol,
          serial_id: null,
          active: false,
          ...payload,
        });
      }
      return { clearing, deactivate };
    },
    onSuccess: (result, { symbol }) => {
      const label = result?.clearing
        ? `ביטול שינוי מתוזמן בקבוצה ${symbol}`
        : result?.deactivate
        ? `תזמון ביטול משתמש פעיל בקבוצה ${symbol}`
        : `תזמון החלפת משתמש פעיל בקבוצה ${symbol}`;
      logActivity({
        action: label,
        type: "עדכון מערכת",
        entity: "ShiftGroup",
      });
      queryClient.invalidateQueries(["shift-groups"]);
      setSwitchDialogSymbol(null);
      setSwitchTargetSerial("");
      setSwitchDate("");
      setSwitchMode("switch");
      toast.success(
        result?.clearing
          ? "השינוי המתוזמן בוטל"
          : result?.deactivate
          ? "ביטול הפעיל תוזמן בהצלחה"
          : "ההחלפה תוזמנה בהצלחה",
      );
    },
    onError: () => toast.error("שגיאה בתזמון השינוי."),
  });

  // 4. Fair shift distribution — only RR and Manager permission holders are
  // in the rotation pool (Admins/None users are excluded from being
  // auto-assigned shifts by this algorithm).
  const runDistributionMutation = useMutation({
    mutationFn: async ({ startDate, endDate }) => {
      // Each group contributes ONE fairness participant — its "representative",
      // the member active at the START of the range (activeMemberSerialIdOnDate,
      // which honors a scheduled switch). The group is treated as a single unit
      // for fairness across a switch: the algorithm runs on the representative,
      // then ownership is remapped per date so shifts on/after the switch date
      // go to the incoming member. This keeps the group's total shift count the
      // same whether or not it switches mid-range.
      const grace = Math.max(0, Math.floor(Number(switchGraceDays)) || 0);
      const peopleBySerial = new Map(
        authorizedPeople.map((p) => [Number(p.serial_id), p]),
      );

      // Constraints (אילוצים): a person is never assigned a shift on a date they
      // set a constraint for. Constraints take effect immediately with no
      // approval, so every non-rejected request counts (the legacy "rejected"
      // status is still excluded for backward compatibility). Fetched fresh so a
      // just-added constraint is respected without relying on cache warmth.
      const considerationRequests =
        await base44.entities.ConsiderationRequest.list();
      const rawProtected = new Map(); // serial_id -> Set(dates)
      considerationRequests
        .filter((r) => r.status !== "rejected" && r.serial_id != null && r.date)
        .forEach((r) => {
          const key = Number(r.serial_id);
          if (!rawProtected.has(key)) rawProtected.set(key, new Set());
          rawProtected.get(key).add(r.date);
        });

      const reps = []; // fairness participants (one per group)
      const protectedDates = new Map(); // repSerial -> Set(dates)
      const repInfo = new Map(); // repSerial -> { switchDate, incomingSerial }
      const ownerRemap = new Map(); // any member serial -> repSerial (for seeding)
      const symbolToRep = new Map(); // group symbol -> repSerial (for history-by-group)

      const addProtected = (repSerial, dates) => {
        if (!dates) return;
        if (!protectedDates.has(repSerial))
          protectedDates.set(repSerial, new Set());
        const set = protectedDates.get(repSerial);
        dates.forEach((d) => set.add(d));
      };

      activeGroupBySymbol.forEach((group, symbol) => {
        const repSerial = activeMemberSerialIdOnDate(group, startDate);
        if (repSerial == null) return; // no active member at range start
        const rep = peopleBySerial.get(Number(repSerial));
        // Only RR/Manager members are in the rotation, and the representative
        // must actually belong to this group (guards a stale scheduled serial).
        if (
          !rep ||
          !["RR", "Manager"].includes(rep.permissions) ||
          rep.sign !== symbol
        )
          return;

        reps.push(rep);
        const repKey = Number(repSerial);
        symbolToRep.set(symbol, repKey);

        // A scheduled deactivate: from that date on the group has no active
        // member, so its slot must receive no shifts on/after it.
        const isDeactivate =
          !!group.scheduled_switch_date && !!group.scheduled_switch_deactivate;
        const deactivateDate = isDeactivate ? group.scheduled_switch_date : null;
        const hasSwitch =
          !!group.scheduled_switch_date &&
          !isDeactivate &&
          group.scheduled_switch_serial_id != null;
        const switchDate = hasSwitch ? group.scheduled_switch_date : null;
        const incomingSerial = hasSwitch
          ? Number(group.scheduled_switch_serial_id)
          : null;
        const outgoingSerial =
          group.active && group.serial_id != null
            ? Number(group.serial_id)
            : null;

        repInfo.set(repKey, { switchDate, incomingSerial });

        // Fold both switch members into the representative so the group's prior
        // in-range shifts (owned by whoever) count as ONE unit for fairness.
        ownerRemap.set(repKey, repKey);
        if (outgoingSerial != null) ownerRemap.set(outgoingSerial, repKey);
        if (incomingSerial != null) ownerRemap.set(incomingSerial, repKey);

        if (hasSwitch && incomingSerial != null) {
          // Constraints, split across the switch date: before it the outgoing
          // member's constraints apply to the group's slot, on/after it the
          // incoming member's.
          if (outgoingSerial != null) {
            const before = [...(rawProtected.get(outgoingSerial) || [])].filter(
              (d) => d < switchDate,
            );
            addProtected(repKey, before);
          }
          const after = [...(rawProtected.get(incomingSerial) || [])].filter(
            (d) => d >= switchDate,
          );
          addProtected(repKey, after);

          // Grace period: leave the incoming member free of shifts for `grace`
          // days from the switch date (the group's slot is protected there).
          if (grace > 0) {
            const graceSet = new Set();
            const base = new Date(switchDate);
            for (let i = 0; i < grace; i++) {
              graceSet.add(format(addDays(base, i), "yyyy-MM-dd"));
            }
            addProtected(repKey, graceSet);
          }
        } else if (isDeactivate) {
          // Scheduled deactivate: the representative (active at range start) holds
          // the group's slot only BEFORE the deactivate date — its own constraints
          // apply there. Every date on/after the deactivate date is protected on
          // the rep so the algorithm never assigns the (now memberless) group a
          // shift; those days flow to the other active groups instead.
          const before = [...(rawProtected.get(repKey) || [])].filter(
            (d) => d < deactivateDate,
          );
          addProtected(repKey, before);

          const goneSet = new Set();
          let cursor = new Date(
            deactivateDate > startDate ? deactivateDate : startDate,
          );
          const rangeEnd = new Date(endDate);
          while (cursor <= rangeEnd) {
            goneSet.add(format(cursor, "yyyy-MM-dd"));
            cursor = addDays(cursor, 1);
          }
          addProtected(repKey, goneSet);
        } else {
          // No scheduled switch — the representative's own constraints.
          addProtected(repKey, rawProtected.get(repKey));
        }
      });

      if (reps.length === 0) {
        throw new Error(
          "אין עובדים זכאים לחלוקה — נדרש משתמש פעיל בקבוצה (RR או Manager, פעיל בקבוצה). הגדירו משתמשים פעילים בלשונית 'ניהול קבוצות'.",
        );
      }

      const holidayDates = new Set(Object.keys(holidaysByDate));

      // Seed the algorithm with existing shifts, but with each group's members
      // folded onto its representative so a group that already switched (or has
      // shifts under both members) is counted as one unit.
      const remappedShifts = allShiftsForDistribution.map((s) => {
        const owner = Number(s.original_user_id);
        const mapped = ownerRemap.get(owner);
        return mapped != null && mapped !== owner
          ? { ...s, original_user_id: mapped }
          : s;
      });

      // Historical fairness baseline (toggle): when enabled, count each group's
      // shifts in the 6 months BEFORE the range start and seed the fairness table
      // with them, so a group that worked a lot recently is deprioritized. Counted
      // BY GROUP — every shift is attributed to its owner's group representative,
      // regardless of which member actually worked it — never per individual user.
      const priorJustice = new Map();
      if (considerHistory) {
        const historyStart = format(subMonths(new Date(startDate), 6), "yyyy-MM-dd");
        allShiftsForDistribution.forEach((s) => {
          if (!s.start_date) return;
          if (s.start_date >= startDate || s.start_date < historyStart) return;
          const owner = peopleBySerial.get(Number(s.original_user_id));
          const repKey = owner?.sign ? symbolToRep.get(owner.sign) : null;
          if (repKey == null) return; // owner's group isn't in the active pool
          priorJustice.set(repKey, (priorJustice.get(repKey) || 0) + 1);
        });
      }

      const result = distributeShifts({
        people: reps,
        existingShifts: remappedShifts,
        startDate,
        endDate,
        holidayDates,
        cholHamoedDates,
        protectedDates,
        priorJustice,
      });

      // Remap each assignment from the representative to the member who is
      // actually active on that date — i.e. hand shifts on/after the switch
      // date to the incoming member.
      const finalAssignments = result.assignments.map((a) => {
        const info = repInfo.get(Number(a.personId));
        if (
          info?.switchDate &&
          info.incomingSerial != null &&
          a.date >= info.switchDate
        ) {
          return { date: a.date, personId: info.incomingSerial };
        }
        return a;
      });

      // Create each shift slot (a pure time slot; Phase 4), then its base
      // "assignment" coverage row recording the owner. Throttled so a large
      // distribution can't trip the rate limiter — creating N shifts + N
      // coverage rows in one burst does.
      await runThrottled(
        finalAssignments.map((a) => async () => {
          const shift = await base44.entities.Shift.create({
            start_date: a.date,
            end_date: a.date,
            start_time: "09:00",
            end_time: "09:00",
          });
          await createAssignmentForShift(shift, a.personId);
        }),
      );

      return { ...result, assignments: finalAssignments };
    },
    onSuccess: (result, { startDate, endDate }) => {
      logActivity({
        action: `חלוקת ${result?.assignments?.length || 0} משמרות (${startDate} — ${endDate})`,
        type: "הוספת משמרות",
        entity: "Shift",
        details: {
          count: result?.assignments?.length || 0,
          start_date: startDate,
          end_date: endDate,
          shifts: (result?.assignments || []).map((a) => ({
            date: a.date,
            owner: authorizedPeople.find(
              (p) => Number(p.serial_id) === Number(a.personId),
            )?.full_name,
          })),
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["coverages"]);
      setDistributionResult(result);
      setDistributionError("");
    },
    onError: (error) => {
      setDistributionError(error?.message || "חלוקת המשמרות נכשלה. נסו שוב.");
      setDistributionResult(null);
    },
  });

  const handleRunDistribution = () => {
    const { startDate, endDate } = distributionRange;
    if (!startDate || !endDate) {
      setDistributionError("נא לבחור תאריך התחלה וסיום");
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      setDistributionError("תאריך הסיום חייב להיות אחרי תאריך ההתחלה");
      return;
    }
    setDistributionError("");
    setDistributionResult(null);
    runDistributionMutation.mutate({ startDate, endDate });
  };

  // 5. Delete all shifts within a chosen date range (e.g. to undo a bad
  // distribution run or clear out a period before re-running it).
  const shiftsInDeleteRange = useMemo(() => {
    const { startDate, endDate } = deleteShiftsRange;
    if (!startDate || !endDate) return [];
    return allShiftsForDistribution.filter(
      (s) => s.start_date >= startDate && s.start_date <= endDate,
    );
  }, [allShiftsForDistribution, deleteShiftsRange]);

  const deleteShiftsRangeMutation = useMutation({
    mutationFn: async (shiftIds) => {
      await Promise.all(shiftIds.map((id) => base44.entities.Shift.delete(id)));
      return shiftIds.length;
    },
    onSuccess: (count) => {
      logActivity({
        action: `מחיקת ${count} משמרות בטווח תאריכים`,
        type: "מחיקת משמרות",
        entity: "Shift",
        details: {
          count,
          start_date: deleteShiftsRange.startDate,
          end_date: deleteShiftsRange.endDate,
          shifts: shiftsInDeleteRange.map((s) => ({
            date: s.start_date,
            start_time: s.start_time,
            end_time: s.end_time,
            owner: authorizedPeople.find(
              (p) => Number(p.serial_id) === Number(s.original_user_id),
            )?.full_name,
          })),
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      toast.success(`נמחקו ${count} משמרות בהצלחה`);
      setIsDeleteShiftsConfirmOpen(false);
      setDeleteShiftsRange({ startDate: "", endDate: "" });
    },
    onError: (error) => {
      toast.error(error?.message || "מחיקת המשמרות נכשלה. נסו שוב.");
    },
  });

  const handleRequestDeleteShiftsRange = () => {
    const { startDate, endDate } = deleteShiftsRange;
    if (!startDate || !endDate) {
      setDeleteShiftsError("נא לבחור תאריך התחלה וסיום");
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      setDeleteShiftsError("תאריך הסיום חייב להיות אחרי תאריך ההתחלה");
      return;
    }
    setDeleteShiftsError("");
    setIsDeleteShiftsConfirmOpen(true);
  };

  const handleConfirmDeleteShiftsRange = () => {
    deleteShiftsRangeMutation.mutate(shiftsInDeleteRange.map((s) => s.id));
  };

  // 6. Replace one user's shifts with another's, within a date range — every
  // shift assigned to `fromUserId` whose start_date falls inside [startDate,
  // endDate] is reassigned to `toUserId` (leaves everyone else's shifts alone).
  const shiftsInReplaceRange = useMemo(() => {
    const { startDate, endDate, fromUserId } = replaceShiftsForm;
    if (!startDate || !endDate || !fromUserId) return [];
    return allShiftsForDistribution.filter(
      (s) =>
        Number(s.original_user_id) === Number(fromUserId) &&
        s.start_date >= startDate &&
        s.start_date <= endDate,
    );
  }, [allShiftsForDistribution, replaceShiftsForm]);

  const replaceShiftsMutation = useMutation({
    mutationFn: async ({ shiftIds, toUserId }) => {
      // Ownership = the base "assignment" coverage row (Phase 4). Repoint it per
      // shift, throttled to stay under the rate limit on big ranges.
      const coverages = await base44.entities.ShiftCoverage.list();
      await runThrottled(
        shiftIds.map(
          (id) => () => syncAssignmentOwner(id, Number(toUserId), coverages),
        ),
      );
      return shiftIds.length;
    },
    onSuccess: (count) => {
      logActivity({
        action: `החלפת ${count} משמרות בין משתמשים`,
        type: "שינויים בהרשאות",
        entity: "ShiftCoverage",
        details: {
          count,
          from: authorizedPeople.find(
            (p) =>
              Number(p.serial_id) === Number(replaceShiftsForm.fromUserId),
          )?.full_name,
          to: authorizedPeople.find(
            (p) => Number(p.serial_id) === Number(replaceShiftsForm.toUserId),
          )?.full_name,
          start_date: replaceShiftsForm.startDate,
          end_date: replaceShiftsForm.endDate,
          shifts: shiftsInReplaceRange.map((s) => ({
            date: s.start_date,
            start_time: s.start_time,
            end_time: s.end_time,
          })),
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["coverages"]);
      toast.success(`הוחלפו ${count} משמרות בהצלחה`);
      setIsReplaceShiftsConfirmOpen(false);
      setReplaceShiftsForm({
        startDate: "",
        endDate: "",
        fromUserId: "",
        toUserId: "",
      });
    },
    onError: (error) => {
      toast.error(error?.message || "החלפת המשמרות נכשלה. נסו שוב.");
    },
  });

  const handleRequestReplaceShifts = () => {
    const { startDate, endDate, fromUserId, toUserId } = replaceShiftsForm;
    if (!fromUserId || !toUserId) {
      setReplaceShiftsError("נא לבחור משתמש מוחלף ומשתמש מחליף");
      return;
    }
    if (Number(fromUserId) === Number(toUserId)) {
      setReplaceShiftsError("יש לבחור שני משתמשים שונים");
      return;
    }
    if (!startDate || !endDate) {
      setReplaceShiftsError("נא לבחור תאריך התחלה וסיום");
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      setReplaceShiftsError("תאריך הסיום חייב להיות אחרי תאריך ההתחלה");
      return;
    }
    if (shiftsInReplaceRange.length === 0) {
      setReplaceShiftsError("לא נמצאו משמרות למשתמש המוחלף בטווח שנבחר");
      return;
    }
    setReplaceShiftsError("");
    setIsReplaceShiftsConfirmOpen(true);
  };

  const handleConfirmReplaceShifts = () => {
    replaceShiftsMutation.mutate({
      shiftIds: shiftsInReplaceRange.map((s) => s.id),
      toUserId: replaceShiftsForm.toUserId,
    });
  };

  // Runs the full test suite (src/lib/testing): pure-logic tests first (no
  // data risk), then the live tests, which create+delete their own [TEST]
  // fixtures. Only reachable after the export/confirm gate below.
  const handleRunTestSuite = async () => {
    setShowTestExportGate(false);
    setIsRunningTests(true);
    setTestResults(null);
    try {
      const pureResults = await runPureTests();
      const liveResults = await runLiveTests();
      setTestResults([...pureResults, ...liveResults]);
      // Cheap insurance: nothing else should still be viewing the transient
      // [TEST] fixtures by the time this runs, but invalidate the shared
      // caches anyway in case any of them got pulled in mid-run.
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      queryClient.invalidateQueries(["coverages"]);
      queryClient.invalidateQueries(["authorized-people"]);
    } finally {
      setIsRunningTests(false);
    }
  };

  // --- HANDLERS ---

  const handleSystemChange = (field, value) => {
    setSystemSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleSupportChange = (field, value) => {
    setSupportSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddUserSubmit = async (e) => {
    e.preventDefault();
    if (!newUser.full_name || !newUser.department || !newUser.email)
      return toast.error("נא למלא את כל שדות החובה");
    setIsSubmitting(true);
    try {
      await addUserMutation.mutateAsync({
        ...newUser,
        sign: newUser.sign || null,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseAddUser = () => {
    setIsAddUserOpen(false);
    // Reset state after animation completes usually, but here immediate is fine for next open
    setTimeout(() => setAddUserStep("form"), 300);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editingUser.full_name || !editingUser.department || !editingUser.email)
      return toast.error("נא למלא את כל שדות החובה");
    setIsSubmitting(true);
    try {
      await updateUserMutation.mutateAsync({
        id: editingUser.id,
        data: editingUser,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSavePermissions = async () => {
    if (!permissionUser || !selectedPermission) return;
    setIsSubmitting(true);
    try {
      await updateUserMutation.mutateAsync({
        id: permissionUser.id,
        data: { permissions: selectedPermission },
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveSign = async () => {
    if (!signUser) return;
    setIsSubmitting(true);
    try {
      await updateUserMutation.mutateAsync({
        id: signUser.id,
        data: { sign: signValue === "none" ? null : signValue },
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (isArchiveMode) {
      toast.success("הבקשה להעברה לארכיון התקבלה (סימולציה)");
      setIsDeleteOpen(false);
      setIsArchiveMode(false);
      setArchiveReason("");
    } else {
      if (userToDelete) {
        setIsSubmitting(true);
        try {
          await deleteUserMutation.mutateAsync(userToDelete.id);
        } finally {
          setIsSubmitting(false);
        }
      }
    }
  };

  // Filter Logic
  const getFilteredPeople = () => {
    const people = authorizedPeople.filter((person) => {
      const searchMatch =
        person.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        person.email?.toLowerCase().includes(searchTerm.toLowerCase());
      const deptMatch =
        selectedDepartments.length === 0 ||
        selectedDepartments.includes(person.department);
      // Archive view shows only "None" users; the main list hides them.
      const isNone = (person.permissions || "None") === "None";
      const archiveMatch = showArchive ? isNone : !isNone;
      return searchMatch && deptMatch && archiveMatch;
    });
    // Active group members (isActiveGroupMember) stay on top; everyone else
    // sinks to the bottom, preserving their existing relative order.
    return [...people].sort((a, b) => {
      const aActive = isActiveGroupMember(a) ? 0 : 1;
      const bActive = isActiveGroupMember(b) ? 0 : 1;
      return aActive - bActive;
    });
  };

  const filteredPeople = getFilteredPeople();

  const tabs = useMemo(
    () => [
      {
        id: "settings",
        label: "הגדרות",
        icon: "https://cdn-icons-png.flaticon.com/128/3247/3247957.png",
      },
      {
        id: "users",
        label: "משתמשים",
        icon: "https://cdn-icons-png.flaticon.com/128/9888/9888730.png",
      },
      {
        id: "groups",
        label: "ניהול קבוצות",
        Icon: Users,
      },
      {
        id: "support",  
        label: "תמיכה",
        icon: "https://cdn-icons-png.flaticon.com/128/15202/15202496.png",
      },
      {
        id: "themes",
        label: "ערכת נושא",
        icon: "https://cdn-icons-png.flaticon.com/128/9521/9521756.png",
      },
      {
        id: "whatsapp",
        label: "הודעות וואטסאפ",
        Icon: MessageSquare,
      },
      {
        id: "logs",
        label: "לוגים",
        icon: "https://cdn-icons-png.flaticon.com/128/10397/10397230.png",
      },
      {
        id: "distribution",
        label: "חלוקת משמרות",
        Icon: Scale,
      },
      {
        id: "consideration",
        label: "אילוצים",
        Icon: Ban,
      },
      {
        id: "tests",
        label: "בדיקות מערכת",
        Icon: FlaskConical,
      },
    ],
    [],
  );

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm z-40"
      />

      {/* Main Container */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-0 m-auto z-50 bg-[#F9FAFB] md:rounded-3xl shadow-2xl w-full max-w-5xl h-full md:h-[90vh] flex flex-col text-right overflow-hidden"
      >
        {/* Header */}
        <div className="bg-white px-4 py-3 md:px-6 md:py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsNavOpen(true)}
              className="p-2 rounded-full hover:bg-gray-100 transition-colors"
              aria-label="פתח תפריט ניווט"
            >
              <Menu className="w-6 h-6 text-gray-600" />
            </button>
            <h2 className="text-xl md:text-2xl font-bold text-gray-800">
              ניהול מערכת
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="w-6 h-6 text-gray-400" />
          </button>
        </div>

        {/* Nav Sidebar (hamburger-triggered, replaces the old tab row) */}
        <AnimatePresence>
          {isNavOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsNavOpen(false)}
                className="absolute inset-0 bg-black/40 z-[60]"
              />
              <motion.div
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "tween", duration: 0.25 }}
                dir="rtl"
                className="absolute top-0 right-0 h-full w-72 max-w-[80%] bg-white z-[70] shadow-2xl flex flex-col"
              >
                <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
                  <span className="font-bold text-gray-800">
                    בחר מודול לניהול
                  </span>
                  <button
                    onClick={() => setIsNavOpen(false)}
                    className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-400" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setActiveTab(tab.id);
                        setIsNavOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold text-right transition-all
                        ${
                          activeTab === tab.id
                            ? "bg-blue-50 text-blue-700"
                            : "text-gray-600 hover:bg-gray-50"
                        }
                      `}
                    >
                      {tab.Icon ? (
                        <tab.Icon className="w-5 h-5 shrink-0" />
                      ) : (
                        <img
                          src={tab.icon}
                          alt={tab.label}
                          className="w-5 h-5 shrink-0"
                        />
                      )}
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden bg-[#F9FAFB] p-3 md:p-5 flex flex-col gap-3 md:gap-4">
          {activeTab === "users" && (
            <div className="flex-1 min-h-0 flex flex-col gap-4 md:gap-6">
              {/* Toolbar */}
              <div className="bg-white p-3 md:p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row items-center justify-between gap-3 md:gap-4">
                <div className="relative w-full md:w-80 lg:w-96">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="חיפוש לפי שם או מייל..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pr-10 h-10 md:h-11 bg-gray-50 border-gray-200 focus:bg-white rounded-xl text-sm"
                  />
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto hide-scrollbar pb-1 md:pb-0 justify-between md:justify-end">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 ml-2 whitespace-nowrap flex items-center gap-1 shrink-0 hidden md:flex">
                      <Filter className="w-4 h-4" /> סינון:
                    </span>
                    {["א", "מ", "ת"].map((dept) => (
                      <button
                        key={dept}
                        onClick={() => {
                          setSelectedDepartments((prev) =>
                            prev.includes(dept)
                              ? prev.filter((d) => d !== dept)
                              : [...prev, dept],
                          );
                        }}
                        className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-medium transition-all border shrink-0 ${
                          selectedDepartments.includes(dept)
                            ? "bg-blue-50 border-blue-200 text-blue-700 shadow-sm"
                            : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {dept}
                      </button>
                    ))}
                  </div>

                  <Button
                    onClick={() => {
                      setAddUserStep("form");
                      setIsAddUserOpen(true);
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2 shadow-md shadow-blue-200 shrink-0 h-10 md:h-11 px-4"
                  >
                    <img
                      src="https://cdn-icons-png.flaticon.com/128/9131/9131530.png"
                      alt="Add"
                      className="w-5 h-5 invert brightness-0 filter"
                      style={{ filter: "brightness(0) invert(1)" }}
                    />
                    <span className="hidden md:inline">הוספה</span>
                  </Button>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex-1 overflow-hidden flex flex-col">
                <div className="hidden md:grid grid-cols-12 gap-4 p-4 border-b border-gray-100 bg-gray-50/50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <div className="col-span-2">שם מלא</div>
                  <div className="col-span-2">מחלקה</div>
                  <div className="col-span-2">אימייל</div>
                  <div className="col-span-2">הרשאות</div>
                  <div className="col-span-2">קבוצה</div>
                  <div className="col-span-1 text-center">קישוריות</div>
                  <div className="col-span-1 text-center">פעולות</div>
                </div>

                <div className="overflow-y-auto flex-1 min-h-0 custom-scrollbar">
                  {isLoadingPeople ? (
                    <div className="flex items-center justify-center h-40 text-gray-400">
                      טוען נתונים...
                    </div>
                  ) : filteredPeople.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-2">
                      <UserX className="w-10 h-10 opacity-20" />
                      <span>לא נמצאו משתמשים</span>
                    </div>
                  ) : (
                    filteredPeople.map((person) => {
                      const permStyle = getPermissionStyle(person.permissions);
                      return (
                        <div
                          key={person.id}
                          className="grid grid-cols-12 gap-2 md:gap-4 p-3 md:p-4 border-b border-gray-50 items-center hover:bg-blue-50/30 transition-colors group relative"
                        >
                          {/* Name */}
                          <div className="col-span-7 md:col-span-2 flex flex-col justify-center">
                            <div className="font-bold text-gray-800 text-sm truncate flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
                                {person.full_name?.charAt(0)}
                              </div>
                              <span className="truncate">
                                {person.full_name}
                              </span>
                            </div>
                            <div className="md:hidden text-xs text-gray-400 mr-10 mt-0.5 flex gap-2">
                              <span>{`מחלקה ${person.department}`}</span> •{" "}
                              <span style={{ color: permStyle.text }}>
                                {person.permissions}
                              </span>
                              {person.sign && (
                                <>
                                  {" • "}
                                  <span
                                    className={
                                      isActiveGroupMember(person)
                                        ? "inline-flex items-center gap-0.5 px-1 rounded bg-amber-100 text-amber-800 font-mono font-bold"
                                        : "text-gray-500 font-mono"
                                    }
                                  >
                                    {isActiveGroupMember(person) && (
                                      <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                                    )}
                                    {person.sign}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Department */}
                          <div className="hidden md:block col-span-2">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                              מחלקה {person.department}
                            </span>
                          </div>

                          {/* Email */}
                          <div className="hidden md:block col-span-2 text-sm text-gray-500 truncate font-mono">
                            {person.email}
                          </div>

                          {/* Permissions (Styled) */}
                          <div className="hidden md:block col-span-2">
                            <span
                              className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border shadow-sm"
                              style={{
                                backgroundColor: permStyle.bg,
                                color: permStyle.text,
                                borderColor: permStyle.border,
                              }}
                            >
                              {person.permissions || "None"}
                            </span>
                          </div>

                          {/* Sign — highlighted (amber + star) when this user is
                              the active member of their group. This standing (a
                              ShiftGroup active member) is what now determines
                              whether the person takes shifts, replacing the old
                              per-person role flag. */}
                          <div className="hidden md:block col-span-2">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-bold border shadow-sm font-mono ${
                                isActiveGroupMember(person)
                                  ? "bg-amber-100 text-amber-800 border-amber-300"
                                  : "bg-gray-50 text-gray-700 border-gray-200"
                              }`}
                            >
                              {isActiveGroupMember(person) && (
                                <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                              )}
                              {person.sign || "—"}
                            </span>
                          </div>

                          {/* Connectivity */}
                          <div className="col-span-3 md:col-span-1 flex justify-center items-center">
                            <img
                              src={
                                isPersonConnected(person)
                                  ? "https://i.imagesup.co/images2/30a37d06678a9808e762570c63cede181682172e.png"
                                  : "https://i.imagesup.co/images2/b4873b1a4a57971b9ab6294adda44a6a184efc66.png"
                              }
                              alt="Status"
                              className="w-6 h-6 object-contain"
                            />
                          </div>

                          {/* Actions */}
                          <div className="col-span-2 md:col-span-1 flex justify-end md:justify-center">
                            <DropdownMenu dir="rtl">
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-lg hover:bg-gray-200"
                                >
                                  <MoreVertical className="w-4 h-4 text-gray-500" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setEditingUser({ ...person });
                                    setIsEditUserOpen(true);
                                  }}
                                  className="flex items-center justify-end gap-2 cursor-pointer text-gray-700"
                                >
                                  <span>עריכה</span>
                                  <Edit2 className="w-4 h-4" />
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setPermissionUser(person);
                                    setSelectedPermission(
                                      person.permissions || "None",
                                    );
                                    setIsPermissionsOpen(true);
                                  }}
                                  className="flex items-center justify-end gap-2 cursor-pointer text-gray-700"
                                >
                                  <span>ניהול הרשאות</span>
                                  <Shield className="w-4 h-4" />
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSignUser(person);
                                    setSignValue(person.sign || "");
                                    setIsSignOpen(true);
                                  }}
                                  className="flex items-center justify-end gap-2 cursor-pointer text-gray-700"
                                >
                                  <span>עריכת קבוצה</span>
                                  <Tag className="w-4 h-4" />
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleSendInvite(person)}
                                  className="flex items-center justify-end gap-2 cursor-pointer text-blue-600 focus:text-blue-700 focus:bg-blue-50"
                                >
                                  <span>שליחת הזמנה</span>
                                  <Send className="w-4 h-4" />
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setUserToDelete(person);
                                    setIsDeleteOpen(true);
                                    setIsArchiveMode(false);
                                  }}
                                  className="flex items-center justify-end gap-2 cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50 border-t mt-1 pt-1"
                                >
                                  <span>מחיקה</span>
                                  <Trash2 className="w-4 h-4" />
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="p-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-500 flex items-center justify-between px-4 md:px-6 shrink-0 gap-3">
                  <Button
                    type="button"
                    size="sm"
                    variant={showArchive ? "default" : "outline"}
                    onClick={() => setShowArchive((prev) => !prev)}
                    className={`gap-1.5 h-8 rounded-lg shrink-0 ${
                      showArchive
                        ? "bg-gray-700 hover:bg-gray-800 text-white"
                        : "border-gray-300 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    <Archive className="w-4 h-4" />
                    {showArchive ? "חזרה לרשימה" : "ארכיון"}
                  </Button>
                  <div className="flex items-center gap-4">
                    <span>סה"כ רשומות: {filteredPeople.length}</span>
                    <span className="hidden md:inline">
                      {showArchive
                        ? "משתמשים ללא הרשאה (None)"
                        : `מציג ${filteredPeople.length} מתוך ${authorizedPeople.length}`}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "groups" && (
            <div className="flex-1 min-h-0 flex flex-col gap-4">
              <div className="bg-white p-3 md:p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-600" /> ניהול קבוצות
                  </p>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    הקבוצות דינמיות — ניתן להוסיף ולהסיר קבוצות. כל משתמש משויך
                    לקבוצה (השדה "קבוצה"), ובכל קבוצה ניתן לסמן משתמש אחד בלבד כ
                    <b>פעיל</b> (או אף אחד) — מערכת חלוקת המשמרות תשבץ משמרות אך
                    ורק למשתמשים הפעילים.
                  </p>
                </div>
                <div className="flex items-center gap-2 justify-between">
                  <div className="relative w-full max-w-xs">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                      placeholder="חיפוש לפי שם קבוצה או משתמש..."
                      className="pr-10 h-9 bg-gray-50 border-gray-200 focus:bg-white rounded-xl text-sm"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={addGroupMutation.isPending}
                    onClick={() => {
                      setNewGroupName("");
                      setAddGroupOpen(true);
                    }}
                    className="gap-1 bg-blue-600 hover:bg-blue-700 text-white h-9 shrink-0"
                  >
                    <Plus className="w-4 h-4" /> הוסף קבוצה
                  </Button>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex-1 overflow-hidden flex flex-col">
                {groupSymbols.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3 p-6 text-center">
                    <Users className="w-10 h-10 opacity-20" />
                    <span>אין קבוצות עדיין</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={seedDefaultGroupsMutation.isPending}
                      onClick={() => seedDefaultGroupsMutation.mutate()}
                      className="gap-1"
                    >
                      <Plus className="w-4 h-4" /> צור 24 קבוצות ברירת מחדל
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-y-auto flex-1 min-h-0 custom-scrollbar p-3 md:p-4">
                    {filteredGroupSymbols.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2 py-8 text-center">
                        <Search className="w-8 h-8 opacity-20" />
                        <span>לא נמצאו קבוצות התואמות לחיפוש</span>
                      </div>
                    ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 content-start">
                      {filteredGroupSymbols.map((symbol) => {
                        const activeSeg = activeGroupBySymbol.get(symbol);
                        // Effective active member for TODAY — honors a scheduled
                        // switch whose date has already passed, so the star
                        // follows the incoming member once the date arrives.
                        const activeSerialId = activeMemberSerialIdOnDate(
                          activeSeg,
                          todayKey(),
                        );
                        const isActiveSerial = (m) =>
                          activeSerialId != null &&
                          Number(m.serial_id) === Number(activeSerialId);
                        // A pending (still-future) scheduled change, if any —
                        // either a switch to another member or a deactivate.
                        const scheduledSwitchDate =
                          activeSeg?.scheduled_switch_date || null;
                        const scheduledSwitchSerial =
                          activeSeg?.scheduled_switch_serial_id ?? null;
                        const scheduledDeactivate =
                          !!activeSeg?.scheduled_switch_deactivate;
                        const isFutureSchedule =
                          !!scheduledSwitchDate &&
                          scheduledSwitchDate > todayKey();
                        const hasPendingSwitch =
                          isFutureSchedule &&
                          !scheduledDeactivate &&
                          scheduledSwitchSerial != null;
                        const hasPendingDeactivate =
                          isFutureSchedule && scheduledDeactivate;
                        const incomingMemberName = hasPendingSwitch
                          ? (membersBySymbol.get(symbol) || []).find(
                              (m) =>
                                Number(m.serial_id) ===
                                Number(scheduledSwitchSerial),
                            )?.full_name || `#${scheduledSwitchSerial}`
                          : null;
                        // Order the active member first, keeping everyone else in
                        // the existing name-sorted order (membersBySymbol is
                        // already sorted by full_name).
                        const members = [...(membersBySymbol.get(symbol) || [])].sort(
                          (a, b) => {
                            const aActive = isActiveSerial(a);
                            const bActive = isActiveSerial(b);
                            if (aActive !== bActive) return aActive ? -1 : 1;
                            return 0;
                          },
                        );
                        // Only treat the group as "has active" when its active
                        // serial_id still belongs to a current member of the group.
                        const hasActiveMember =
                          activeSerialId != null &&
                          members.some((m) => isActiveSerial(m));
                        return (
                          <div
                            key={symbol}
                            className="border border-gray-100 rounded-xl p-3 flex flex-col gap-2 bg-gray-50/40"
                          >
                            {/* Group header + add button */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center text-base font-bold border border-blue-100">
                                  {symbol}
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-gray-800">
                                    קבוצה {symbol}
                                  </p>
                                  <p className="text-[11px] text-gray-400">
                                    {members.length} חברים
                                    {hasActiveMember
                                      ? " · יש פעיל"
                                      : " · אין פעיל"}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1 text-xs h-8"
                                  onClick={() => {
                                    setGroupPickerSymbol(symbol);
                                    setGroupPickerSelected([]);
                                    setGroupPickerSearch("");
                                  }}
                                >
                                  <UserPlus className="w-3.5 h-3.5" /> הוסף
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title="תזמן החלפה / ביטול משתמש פעיל"
                                  className={`h-8 w-8 ${
                                    hasPendingSwitch || hasPendingDeactivate
                                      ? "text-blue-600"
                                      : "text-gray-300 hover:text-blue-600"
                                  }`}
                                  onClick={() => {
                                    setSwitchDialogSymbol(symbol);
                                    setSwitchMode(
                                      scheduledDeactivate
                                        ? "deactivate"
                                        : "switch",
                                    );
                                    setSwitchTargetSerial(
                                      scheduledSwitchSerial != null
                                        ? String(scheduledSwitchSerial)
                                        : "",
                                    );
                                    setSwitchDate(scheduledSwitchDate || "");
                                  }}
                                >
                                  <CalendarDays className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title="הסר קבוצה"
                                  className="h-8 w-8 text-gray-300 hover:text-red-500"
                                  onClick={() => setGroupToDelete(symbol)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>

                            {/* Pending scheduled active-member change (switch or deactivate) */}
                            {(hasPendingSwitch || hasPendingDeactivate) && (
                              <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 bg-blue-50 border border-blue-200">
                                <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-blue-700">
                                  <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate">
                                    {hasPendingDeactivate
                                      ? `ביטול משתמש פעיל מתוזמן בתאריך ${formatILDate(scheduledSwitchDate)}`
                                      : `החלפה מתוזמנת ל־${incomingMemberName} בתאריך ${formatILDate(scheduledSwitchDate)}`}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="text-[11px] font-semibold text-blue-600 hover:text-red-500 shrink-0"
                                  disabled={scheduleSwitchMutation.isPending}
                                  onClick={() =>
                                    scheduleSwitchMutation.mutate({
                                      symbol,
                                      targetSerialId: null,
                                      date: null,
                                    })
                                  }
                                >
                                  ביטול
                                </button>
                              </div>
                            )}

                            {/* Members */}
                            {members.length === 0 ? (
                              <p className="text-xs text-gray-300 py-3 text-center">
                                אין חברים בקבוצה
                              </p>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {members.map((m) => {
                                  const isActive = isActiveSerial(m);
                                  return (
                                    <div
                                      key={m.id}
                                      className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 border ${
                                        isActive
                                          ? "bg-amber-50 border-amber-200"
                                          : "bg-white border-gray-100"
                                      }`}
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-sm text-gray-700 truncate">
                                          {m.full_name}
                                        </span>
                                        {isActive && (
                                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-800 font-semibold shrink-0">
                                            פעיל
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0">
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          title={
                                            isActive ? "בטל פעיל" : "סמן כפעיל"
                                          }
                                          className={`h-7 w-7 ${
                                            isActive
                                              ? "text-amber-500"
                                              : "text-gray-300 hover:text-amber-500"
                                          }`}
                                          onClick={() =>
                                            setActiveMemberMutation.mutate({
                                              symbol,
                                              person: isActive ? null : m,
                                            })
                                          }
                                        >
                                          <Star
                                            className={`w-4 h-4 ${
                                              isActive ? "fill-amber-400" : ""
                                            }`}
                                          />
                                        </Button>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          title="הסר מהקבוצה"
                                          className="h-7 w-7 text-gray-300 hover:text-red-500"
                                          onClick={() =>
                                            setMemberToRemove({
                                              person: m,
                                              symbol,
                                            })
                                          }
                                        >
                                          <UserMinus className="w-4 h-4" />
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "settings" && (
            <div className="space-y-2 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        מאפייני המערכת
                      </p>
                      <p className="text-xs text-gray-500">
                        כותרות ושדות לזיהוי מהיר במנועי חיפוש
                      </p>
                    </div>
                    <Globe className="w-5 h-5 text-blue-500" />
                  </div>
                  <div className="grid gap-1.5" dir="rtl">
                    <div className="grid gap-1">
                      <Label className="text-sm text-gray-700">
                        כותרת ראשית
                      </Label>
                      <Input
                        value={systemSettings.title}
                        onChange={(e) =>
                          handleSystemChange("title", e.target.value)
                        }
                        className="rounded-xl"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-sm text-gray-700">תת כותרת</Label>
                      <Input
                        value={systemSettings.subtitle}
                        onChange={(e) =>
                          handleSystemChange("subtitle", e.target.value)
                        }
                        className="rounded-xl"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-sm text-gray-700">
                        מילות מפתח
                      </Label>
                      <Textarea
                        value={systemSettings.keywords}
                        onChange={(e) =>
                          handleSystemChange("keywords", e.target.value)
                        }
                        className="rounded-xl min-h-[72px]"
                        placeholder='לדוגמה: "משמרת", "החלפה", Razarto'
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-sm text-gray-700">לוגו</Label>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml"
                        onChange={handleLogoFileUpload}
                        disabled={isUploadingLogo}
                        className="block w-full text-sm text-gray-600 file:mr-2 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer disabled:opacity-60"
                      />
                      {logoUrl && (
                        <p className="text-xs text-gray-400 mt-1">
                          לוגו נוכחי מוגדר — ניתן גם להחליף אותו בלחיצה על הלוגו
                          בפינה העליונה של האפליקציה.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        זמינות המערכת
                      </p>
                      <p className="text-xs text-gray-500">
                        הפעלת מצב תחזוקה והודעות למשתמשים
                      </p>
                    </div>
                    <CalendarDays className="w-5 h-5 text-blue-500" />
                  </div>
                  <div className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-gray-800">
                        סטטוס מערכת
                      </span>
                      <span className="text-xs text-gray-500">
                        {systemStatus ? "פעיל ומחובר" : "כבוי - מצב תחזוקה"}
                      </span>
                    </div>
                    <button
                      onClick={() => setSystemStatus(!systemStatus)}
                      className={`relative inline-flex h-10 w-16 items-center rounded-full border px-1 transition ${systemStatus ? "bg-emerald-50 border-emerald-200" : "bg-gray-100 border-gray-200"}`}
                      aria-pressed={systemStatus}
                    >
                      <span
                        className={`absolute inset-y-1 ${systemStatus ? "left-1" : "right-1"} w-8 rounded-full bg-white shadow flex items-center justify-center text-xs font-semibold text-gray-700 transition-all`}
                      >
                        {systemStatus ? "ON" : "OFF"}
                      </span>
                    </button>
                  </div>
                  <div className="grid gap-1.5" dir="rtl">
                    <div className="grid gap-1">
                      <Label className="text-sm text-gray-700">
                        הודעה שמופיעה כשהמערכת כבויה
                      </Label>
                      <Textarea
                        value={systemSettings.offlineMessage}
                        onChange={(e) =>
                          handleSystemChange("offlineMessage", e.target.value)
                        }
                        className="rounded-xl min-h-[100px]"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-sm text-gray-700">דומיין</Label>
                      <Input
                        value="www.razar-toran-b555aef5.base44.app"
                        readOnly
                        className="rounded-xl bg-gray-50 text-gray-500"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-sm text-gray-700">תשתית</Label>
                      <Input
                        value="base44"
                        readOnly
                        className="rounded-xl bg-gray-50 text-gray-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      מצב צפייה בלבד
                    </p>
                    <p className="text-xs text-gray-500">
                      התייחסות זמנית לכל משתמשי RR כבעלי הרשאת צפייה בלבד — הם
                      רואים את כל מה שגלוי למשתמש RR, אך אינם יכולים לפתוח בקשות
                      החלפה או לשנות נתונים כלשהם. ההרשאות הקבועות שלהם אינן
                      משתנות.
                    </p>
                  </div>
                  <Eye className="w-5 h-5 text-indigo-500" />
                </div>
                <div className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-gray-800">
                      הרשאת צפייה למשתמשי RR
                    </span>
                    <span className="text-xs text-gray-500">
                      {viewerModeOn
                        ? "פעיל — משתמשי RR במצב קריאה בלבד"
                        : "כבוי — משתמשי RR פועלים כרגיל"}
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      toggleViewerModeMutation.mutate(!viewerModeOn)
                    }
                    disabled={toggleViewerModeMutation.isPending}
                    className={`relative inline-flex h-10 w-16 items-center rounded-full border px-1 transition disabled:opacity-60 ${viewerModeOn ? "bg-indigo-50 border-indigo-200" : "bg-gray-100 border-gray-200"}`}
                    aria-pressed={viewerModeOn}
                  >
                    <span
                      className={`absolute inset-y-1 ${viewerModeOn ? "left-1" : "right-1"} w-8 rounded-full bg-white shadow flex items-center justify-center text-xs font-semibold text-gray-700 transition-all`}
                    >
                      {viewerModeOn ? "ON" : "OFF"}
                    </span>
                  </button>
                </div>
              </div>

              <div className="sticky bottom-0 left-0 z-30 -mx-1 mt-2 flex justify-start px-1 pt-3 pb-2 bg-gradient-to-t from-[#F9FAFB] via-[#F9FAFB]/95 to-transparent">
                <Button
                  onClick={() => saveSystemSettingsMutation.mutate()}
                  disabled={saveSystemSettingsMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2 shadow-lg shadow-blue-300/60 h-11 px-6"
                >
                  {saveSystemSettingsMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  <span>שמירת שינויים</span>
                </Button>
              </div>
            </div>
          )}

          {activeTab === "support" && (
            <div className="space-y-3 md:space-y-4 overflow-y-auto">
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      הגדרות חלון עזרה ותמיכה
                    </p>
                    <p className="text-xs text-gray-500">
                      קישורים לחומרים ומספרי טלפון ישירים
                    </p>
                  </div>
                  <HelpCircle className="w-5 h-5 text-blue-500" />
                </div>
                <div
                  className="grid grid-cols-1 md:grid-cols-2 gap-3"
                  dir="rtl"
                >
                  <div className="grid gap-1">
                    <Label className="text-sm text-gray-700">
                      קישור לסרטון הדרכה
                    </Label>
                    <Input
                      value={supportSettings.videoUrl}
                      onChange={(e) =>
                        handleSupportChange("videoUrl", e.target.value)
                      }
                      className="rounded-xl"
                      dir="ltr"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-sm text-gray-700">
                      מס' טלפון משתמשים והרשאות
                    </Label>
                    <Input
                      value={supportSettings.permissionsPhone}
                      onChange={(e) =>
                        handleSupportChange("permissionsPhone", e.target.value)
                      }
                      className="rounded-xl"
                      dir="ltr"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-sm text-gray-700">
                      מס' טלפון הצעות ובעיות במערכת
                    </Label>
                    <Input
                      value={supportSettings.issuesPhone}
                      onChange={(e) =>
                        handleSupportChange("issuesPhone", e.target.value)
                      }
                      className="rounded-xl"
                      dir="ltr"
                    />
                  </div>
                </div>
              </div>

              <FaqManager />

              <div className="sticky bottom-0 left-0 z-30 -mx-1 mt-2 flex justify-start px-1 pt-3 pb-2 bg-gradient-to-t from-[#F9FAFB] via-[#F9FAFB]/95 to-transparent">
                <Button
                  onClick={() => saveSupportSettingsMutation.mutate()}
                  disabled={saveSupportSettingsMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2 shadow-lg shadow-blue-300/60 h-11 px-6"
                >
                  {saveSupportSettingsMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  <span>שמירת שינויים</span>
                </Button>
              </div>
            </div>
          )}

          {activeTab === "themes" && <ThemesTab />}

          {activeTab === "whatsapp" && (
            <div className="space-y-3 md:space-y-4 overflow-y-auto" dir="rtl">
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-[#25D366]/10 flex items-center justify-center shrink-0">
                    <MessageSquare className="w-5 h-5 text-[#128C7E]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      הודעות וואטסאפ מוכנות מראש
                    </p>
                    <p className="text-xs text-gray-500">
                      עריכת ההודעה שנשלחת לכל סוג בקשה. הסמנים בסוגריים מסולסלים
                      (למשל <span dir="ltr">{"{ownerName}"}</span>) מוחלפים
                      אוטומטית בערכים האמיתיים בעת השליחה.
                    </p>
                  </div>
                </div>
              </div>

              {Object.entries(WHATSAPP_TEMPLATES).map(([key, def]) => (
                <div
                  key={key}
                  className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        {def.label}
                      </p>
                      <p className="text-xs text-gray-500">{def.description}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setWhatsappTemplatesState((prev) => ({
                          ...prev,
                          [key]: def.default,
                        }))
                      }
                      disabled={whatsappTemplates[key] === def.default}
                      className="text-xs text-gray-500 hover:text-gray-700 gap-1.5 shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      שחזור ברירת מחדל
                    </Button>
                  </div>

                  <Textarea
                    dir="rtl"
                    value={whatsappTemplates[key]}
                    onChange={(e) =>
                      setWhatsappTemplatesState((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                    rows={7}
                    className="rounded-xl text-sm leading-relaxed whitespace-pre-wrap"
                  />

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-gray-400">סמנים זמינים:</span>
                    {def.placeholders.map((ph) => (
                      <code
                        key={ph}
                        dir="ltr"
                        className="text-[11px] bg-gray-100 text-gray-600 rounded-md px-1.5 py-0.5 font-mono"
                      >
                        {`{${ph}}`}
                      </code>
                    ))}
                  </div>
                </div>
              ))}

              <div className="flex justify-end pt-1 pb-2">
                <Button
                  onClick={() => saveWhatsappTemplatesMutation.mutate()}
                  disabled={saveWhatsappTemplatesMutation.isPending}
                  className="bg-[#25D366] hover:bg-[#128C7E] text-white rounded-xl gap-2"
                >
                  {saveWhatsappTemplatesMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  <span>שמירת הודעות</span>
                </Button>
              </div>
            </div>
          )}

          {activeTab === "logs" && <LogsTab />}

          {activeTab === "distribution" && (
            <div className="space-y-4 md:space-y-6 overflow-y-auto">
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      חלוקה הוגנת של משמרות
                    </p>
                    <p className="text-xs text-gray-500 max-w-xl">
                      מפזר משמרות רק על ימים פנויים בטווח שנבחר, בלי לגעת
                      במשמרות קיימות: עד שתי משמרות מוקצות לכל אדם בשבוע
                      (א'-ש'), שישי-שבת תמיד מוקצים יחד לאותו אדם, וכך גם ערב חג
                      וימי החג (למשל ערב חג שחל בחמישי — המשמרת נשארת אצל אותו
                      אדם עד שבת). ימי חול המועד (בסוכות ובפסח) לא נכללים בצירוף
                      הזה ומתחלקים כרגיל בין העובדים, כדי שמשמרת החג לא תימשך
                      יותר מדי אצל אדם אחד. הפיזור בין המשמרות של כל אדם נשמר
                      נוח ולא יום אחרי יום בטעות. הבחירה מתבססת על טבלת "צדק" —
                      עדיפות ניתנת לפי מספר המשמרות הנמוך ביותר שנצבר בטווח
                      שנבחר.
                    </p>
                  </div>
                  <Scale className="w-5 h-5 text-blue-500 shrink-0" />
                </div>

                <div
                  className="grid grid-cols-1 md:grid-cols-2 gap-3"
                  dir="rtl"
                >
                  <div className="grid gap-1">
                    <Label className="text-sm text-gray-700">תאריך התחלה</Label>
                    <DateInputIL
                      value={distributionRange.startDate}
                      onChange={(iso) =>
                        setDistributionRange((prev) => ({
                          ...prev,
                          startDate: iso,
                        }))
                      }
                      className="rounded-xl"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-sm text-gray-700">תאריך סיום</Label>
                    <DateInputIL
                      value={distributionRange.endDate}
                      onChange={(iso) =>
                        setDistributionRange((prev) => ({
                          ...prev,
                          endDate: iso,
                        }))
                      }
                      className="rounded-xl"
                    />
                  </div>
                </div>

                <div className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
                  <div className="flex items-start gap-2">
                    <History className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        התחשבות ב-6 החודשים האחרונים
                      </p>
                      <p className="text-xs text-gray-500 max-w-md">
                        כאשר מופעל, החלוקה מתחשבת במספר המשמרות שכל קבוצה צברה
                        ב-6 החודשים שקדמו לתאריך ההתחלה (לפי קבוצות, לא לפי
                        משתמשים), כדי לאזן את העומס לאורך זמן. כבוי — הצדק מחושב
                        רק בטווח שנבחר.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={considerHistory}
                    onClick={() => setConsiderHistory((prev) => !prev)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      considerHistory ? "bg-blue-600" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        considerHistory ? "-translate-x-5" : "-translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                {distributionError && (
                  <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">
                    {distributionError}
                  </p>
                )}

                <Button
                  onClick={handleRunDistribution}
                  disabled={runDistributionMutation.isPending}
                  className="w-full md:w-auto mt-4 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-2"
                >
                  {runDistributionMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> מחלק
                      משמרות...
                    </>
                  ) : (
                    <>
                      <Scale className="w-4 h-4" /> הפעל חלוקה הוגנת
                    </>
                  )}
                </Button>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      תקופת חסד להחלפה מתוזמנת
                    </p>
                    <p className="text-xs text-gray-500 max-w-xl">
                      כאשר מתוזמנת החלפת משתמש פעיל בקבוצה (בלשונית "ניהול
                      קבוצות"), המשתמש הנכנס יישאר פנוי ממשמרות למשך מספר הימים
                      שנבחר מתאריך ההחלפה — חלוקת המשמרות תדלג עליו בתקופה זו. 0 =
                      ללא תקופת חסד. ברירת המחדל: 30 ימים.
                    </p>
                  </div>
                  <CalendarDays className="w-5 h-5 text-blue-500 shrink-0" />
                </div>
                <div className="flex items-end gap-3" dir="rtl">
                  <div className="grid gap-1">
                    <Label className="text-sm text-gray-700">
                      ימי כבוד למשתמש הנכנס
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={switchGraceDays}
                      onChange={(e) => setSwitchGraceDays(e.target.value)}
                      className="rounded-xl w-32"
                    />
                  </div>
                  <Button
                    onClick={() => saveSwitchGraceMutation.mutate()}
                    disabled={saveSwitchGraceMutation.isPending}
                    className="h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-2"
                  >
                    {saveSwitchGraceMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> שומר...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" /> שמור
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      מחיקת משמרות בטווח תאריכים
                    </p>
                    <p className="text-xs text-gray-500 max-w-xl">
                      מוחק לצמיתות את כל המשמרות בטווח שנבחר (כולל שני
                      התאריכים). שימושי לניקוי טווח לפני הרצה מחדש של חלוקה
                      הוגנת. פעולה זו אינה הפיכה.
                    </p>
                  </div>
                  <Trash2 className="w-5 h-5 text-red-500 shrink-0" />
                </div>

                <div
                  className="grid grid-cols-1 md:grid-cols-2 gap-3"
                  dir="rtl"
                >
                  <div className="grid gap-1">
                    <Label className="text-sm text-gray-700">תאריך התחלה</Label>
                    <DateInputIL
                      value={deleteShiftsRange.startDate}
                      onChange={(iso) =>
                        setDeleteShiftsRange((prev) => ({
                          ...prev,
                          startDate: iso,
                        }))
                      }
                      className="rounded-xl"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-sm text-gray-700">תאריך סיום</Label>
                    <DateInputIL
                      value={deleteShiftsRange.endDate}
                      onChange={(iso) =>
                        setDeleteShiftsRange((prev) => ({
                          ...prev,
                          endDate: iso,
                        }))
                      }
                      className="rounded-xl"
                    />
                  </div>
                </div>

                {deleteShiftsError && (
                  <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">
                    {deleteShiftsError}
                  </p>
                )}

                <Button
                  onClick={handleRequestDeleteShiftsRange}
                  variant="destructive"
                  className="w-full md:w-auto mt-4 h-11 rounded-xl gap-2"
                >
                  <Trash2 className="w-4 h-4" /> מחק משמרות בטווח
                </Button>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      החלפת משמרות בין משתמשים
                    </p>
                    <p className="text-xs text-gray-500 max-w-xl">
                      מעביר את כל המשמרות של המשתמש המוחלף אל המשתמש המחליף,
                      בטווח התאריכים שנבחר (כולל שני התאריכים). משמרות של
                      משתמשים אחרים לא מושפעות.
                    </p>
                  </div>
                  <ArrowLeftRight className="w-5 h-5 text-blue-500 shrink-0" />
                </div>

                <div
                  className="grid grid-cols-1 md:grid-cols-2 gap-3"
                  dir="rtl"
                >
                  <div className="grid gap-1">
                    <Label className="text-sm text-gray-700">
                      משתמש מוחלף (מעביר את משמרותיו)
                    </Label>
                    <UserComboBox
                      users={authorizedPeople}
                      value={replaceShiftsForm.fromUserId}
                      excludeId={replaceShiftsForm.toUserId}
                      placeholder="בחר משתמש מוחלף"
                      onChange={(id) =>
                        setReplaceShiftsForm((prev) => ({
                          ...prev,
                          fromUserId: id,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-sm text-gray-700">
                      משתמש מחליף (מקבל את המשמרות)
                    </Label>
                    <UserComboBox
                      users={authorizedPeople}
                      value={replaceShiftsForm.toUserId}
                      excludeId={replaceShiftsForm.fromUserId}
                      placeholder="בחר משתמש מחליף"
                      onChange={(id) =>
                        setReplaceShiftsForm((prev) => ({
                          ...prev,
                          toUserId: id,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-sm text-gray-700">תאריך התחלה</Label>
                    <DateInputIL
                      value={replaceShiftsForm.startDate}
                      onChange={(iso) =>
                        setReplaceShiftsForm((prev) => ({
                          ...prev,
                          startDate: iso,
                        }))
                      }
                      className="rounded-xl"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-sm text-gray-700">תאריך סיום</Label>
                    <DateInputIL
                      value={replaceShiftsForm.endDate}
                      onChange={(iso) =>
                        setReplaceShiftsForm((prev) => ({
                          ...prev,
                          endDate: iso,
                        }))
                      }
                      className="rounded-xl"
                    />
                  </div>
                </div>

                {replaceShiftsError && (
                  <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">
                    {replaceShiftsError}
                  </p>
                )}

                <Button
                  onClick={handleRequestReplaceShifts}
                  disabled={replaceShiftsMutation.isPending}
                  className="w-full md:w-auto mt-4 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-2"
                >
                  <ArrowLeftRight className="w-4 h-4" /> החלף משמרות
                </Button>
              </div>

              {distributionResult && (
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                  <div className="flex items-center gap-2 text-emerald-700">
                    <CheckCircle2 className="w-5 h-5" />
                    <p className="text-sm font-semibold">
                      נוצרו {distributionResult.assignments.length} משמרות חדשות
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-2">
                      טבלת הצדק (סה"כ משמרות לכל הזמנים, אחרי הריצה)
                    </p>
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                      {distributionResult.justiceTable.map((row) => (
                        <div
                          key={row.personId}
                          className="flex items-center justify-between text-sm bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5"
                        >
                          <span className="text-gray-700 font-medium">
                            {row.name}
                          </span>
                          <span className="text-gray-500 font-mono text-xs">
                            {row.totalShifts} משמרות
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {distributionResult.skipped.length > 0 && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                      <p className="text-xs font-semibold text-yellow-800 mb-1">
                        ימים שלא שובצו (לא אותר אדם זמין עם מכסה שבועית פנויה)
                      </p>
                      <div className="text-xs text-yellow-800 space-y-0.5">
                        {distributionResult.skipped.map((s, idx) => (
                          <p key={`${s.date}-${idx}`} dir="ltr">
                            {format(new Date(s.date), "dd/MM/yyyy")}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "consideration" && (
            <div className="space-y-4 md:space-y-6 overflow-y-auto">
              <div className="bg-white p-4 md:p-6 rounded-2xl border border-gray-100 shadow-sm max-w-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Ban className="w-5 h-5 text-indigo-500" />
                  <h3 className="font-bold text-gray-800">הגדרות אילוצים</h3>
                </div>
                <p className="text-sm text-gray-500 leading-relaxed mb-4">
                  סף האילוצים החודשי (K). משתמשים רשאים להגדיר כמה אילוצים שירצו,
                  והם נלקחים בחשבון בחלוקת המשמרות מיד וללא צורך באישור. כאשר משתמש
                  חורג מ-K אילוצים בחודש בודד, המנהלים מקבלים על כך התראה (בלשונית
                  זו ובסרגל ההודעות) כדי לבדוק את החריגה ולמחוק אילוצים במידת הצורך.
                </p>
                <div className="flex items-end gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500">
                      סף אילוצים חודשי (K)
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={considerationMax}
                      onChange={(e) => setConsiderationMax(e.target.value)}
                      className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white w-32"
                      dir="ltr"
                    />
                  </div>
                  <Button
                    onClick={() => saveConsiderationMutation.mutate()}
                    disabled={saveConsiderationMutation.isPending}
                    className="rounded-xl h-10 bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    {saveConsiderationMutation.isPending ? "שומר..." : "שמירה"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "tests" && (
            <div className="space-y-4 md:space-y-6 overflow-y-auto">
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      בדיקות מערכת
                    </p>
                    <p className="text-xs text-gray-500 max-w-xl">
                      מריץ בדיקות אוטומטיות על תהליכים קריטיים (יצירה/ביטול של
                      בקשות החלפה, ראש בראש, כיסוי חלקי, בקשה כללית, שיוך מחדש,
                      וחלוקת משמרות הוגנת) ומציג אם הם עוברים. חלק מהבדיקות
                      יוצרות משתמשים/משמרות/בקשות זמניים בפועל במסד הנתונים
                      (מסומנים בקידומת "[TEST]") ומוחקות אותם אוטומטית בסיום כל
                      בדיקה — נתונים אמיתיים לא נגעים בהם.
                    </p>
                  </div>
                  <FlaskConical className="w-5 h-5 text-blue-500 shrink-0" />
                </div>

                <Button
                  onClick={() => setShowTestExportGate(true)}
                  disabled={isRunningTests}
                  className="w-full md:w-auto h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-2"
                >
                  {isRunningTests ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> מריץ
                      בדיקות...
                    </>
                  ) : (
                    <>
                      <FlaskConical className="w-4 h-4" /> הרץ בדיקות מערכת
                    </>
                  )}
                </Button>
              </div>

              {testResults && (
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3">
                  <div className="flex items-center gap-2">
                    {testResults.every((r) => r.status === "passed") ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-red-600" />
                    )}
                    <p className="text-sm font-semibold text-gray-800">
                      {testResults.filter((r) => r.status === "passed").length}/
                      {testResults.length} עברו בהצלחה
                    </p>
                  </div>
                  <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                    {testResults.map((r) => (
                      <div
                        key={r.id}
                        className={`flex items-start gap-2 p-2.5 rounded-xl border text-sm ${
                          r.status === "passed"
                            ? "bg-emerald-50 border-emerald-200"
                            : "bg-red-50 border-red-200"
                        }`}
                      >
                        {r.status === "passed" ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-800">
                              {r.name}
                            </span>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                                r.category === "pure"
                                  ? "bg-blue-50 text-blue-700 border-blue-200"
                                  : "bg-purple-50 text-purple-700 border-purple-200"
                              }`}
                            >
                              {r.category === "pure" ? "לוגיקה" : "נתונים"}
                            </span>
                          </div>
                          {r.error && (
                            <p className="text-xs text-red-700 mt-1 break-words">
                              {r.error}
                            </p>
                          )}
                        </div>
                        <span className="text-[10px] text-gray-400 shrink-0">
                          {Math.round(r.durationMs)}ms
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* --- Test suite export/confirm gate --- */}
      <Dialog open={showTestExportGate} onOpenChange={setShowTestExportGate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="w-5 h-5" />
              לפני שממשיכים
            </DialogTitle>
            <DialogDescription>
              חלק מהבדיקות (יצירה/ביטול של בקשות החלפה וכד') יוצרות משתמשים,
              משמרות ובקשות זמניים בפועל במסד הנתונים החי, ומוחקות אותם אוטומטית
              מיד בסיום כל בדיקה — נתונים אמיתיים לא נגעים בהם. ליתר ביטחון
              (למשל אם הדפדפן ייסגר באמצע ההרצה), מומלץ לייצא גיבוי של הנתונים
              לפני שממשיכים.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setShowTestExportGate(false)}
            >
              ביטול
            </Button>
            <Button
              variant="outline"
              onClick={() => exportAllData()}
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              ייצוא נתונים
            </Button>
            <Button
              onClick={handleRunTestSuite}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              המשך בכל זאת
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- 1. ADD USER MODAL (Multi-Step) --- */}
      <Dialog open={isAddUserOpen} onOpenChange={handleCloseAddUser}>
        <DialogContent
          className="sm:max-w-[425px] text-right"
          dir="rtl"
          closePosition="left-4 top-4"
        >
          {addUserStep === "form" ? (
            <>
              <DialogHeader className="text-right">
                <DialogTitle className="flex items-center gap-2 text-xl">
                  <div className="bg-blue-100 p-2 rounded-full">
                    <UserPlus className="w-5 h-5 text-blue-600" />
                  </div>
                  הוספת משתמש מורשה
                </DialogTitle>
                <DialogDescription className="text-right">
                  מלא את פרטי המשתמש החדש.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddUserSubmit} className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="full_name" className="text-right">
                    שם מלא
                  </Label>
                  <Input
                    id="full_name"
                    value={newUser.full_name}
                    onChange={(e) =>
                      setNewUser({ ...newUser, full_name: e.target.value })
                    }
                    required
                    className="text-right"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="department" className="text-right">
                    מחלקה
                  </Label>
                  <Select
                    value={newUser.department}
                    onValueChange={(val) =>
                      setNewUser({ ...newUser, department: val })
                    }
                    required
                  >
                    <SelectTrigger className="w-full text-right" dir="rtl">
                      <SelectValue placeholder="בחר מחלקה" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="א">מחלקה א</SelectItem>
                      <SelectItem value="מ">מחלקה מ</SelectItem>
                      <SelectItem value="ת">מחלקה ת</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email" className="text-right">
                    כתובת מייל
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={newUser.email}
                    onChange={(e) =>
                      setNewUser({ ...newUser, email: e.target.value })
                    }
                    dir="ltr"
                    className="text-left"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="permissions" className="text-right">
                    רמת הרשאות
                  </Label>
                  <Select
                    value={newUser.permissions}
                    onValueChange={(val) =>
                      setNewUser({ ...newUser, permissions: val })
                    }
                  >
                    <SelectTrigger className="w-full text-right" dir="rtl">
                      <SelectValue placeholder="בחר הרשאה" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="None">ללא גישה (None)</SelectItem>
                      <SelectItem value="Viewer">צפייה בלבד (Viewer)</SelectItem>
                      <SelectItem value="RR">משתמש רגיל (RR)</SelectItem>
                      <SelectItem value="Manager">מנהל (Manager)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="new_user_group" className="text-right">
                    קבוצה
                  </Label>
                  <Select
                    value={newUser.sign || "none"}
                    onValueChange={(val) =>
                      setNewUser({
                        ...newUser,
                        sign: val === "none" ? "" : val,
                      })
                    }
                  >
                    <SelectTrigger className="w-full text-right" dir="rtl">
                      <SelectValue placeholder="בחר קבוצה" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="none">ללא קבוצה</SelectItem>
                      {groupSymbols.map((symbol) => (
                        <SelectItem key={symbol} value={symbol}>
                          {symbol}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </form>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" onClick={handleCloseAddUser}>
                  ביטול
                </Button>
                <Button
                  onClick={handleAddUserSubmit}
                  disabled={isSubmitting}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {isSubmitting ? "שומר..." : "הוסף משתמש"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            // --- SUCCESS STEP ---
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center text-center p-4 gap-4"
            >
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-2">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-800">
                המשתמש התווסף!
              </h2>
              <p className="text-gray-600">
                המשתמש <b>{addedUserData?.full_name}</b> התווסף למערכת בהצלחה.
              </p>

              <div className="flex flex-col w-full gap-3 mt-4">
                <Button
                  onClick={() => handleSendInvite(addedUserData)}
                  className="w-full bg-[#25D366] hover:bg-[#128C7E] text-white gap-2 h-12 text-md rounded-xl"
                >
                  <img
                    src="https://cdn-icons-png.flaticon.com/128/3670/3670051.png"
                    alt="WhatsApp"
                    className="w-5 h-5 brightness-0 invert"
                    style={{ filter: "brightness(0) invert(1)" }}
                  />
                  שתף הזמנה בוואטסאפ
                </Button>

                <Button
                  variant="outline"
                  onClick={handleCloseAddUser}
                  className="w-full h-11 rounded-xl"
                >
                  סגירה
                </Button>
              </div>
            </motion.div>
          )}
        </DialogContent>
      </Dialog>

      {/* --- 2. EDIT USER MODAL --- */}
      <Dialog open={isEditUserOpen} onOpenChange={setIsEditUserOpen}>
        <DialogContent className="sm:max-w-[425px] text-right" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <div className="bg-indigo-100 p-2 rounded-full">
                <Edit2 className="w-5 h-5 text-indigo-600" />
              </div>
              עריכת פרטי משתמש
            </DialogTitle>
            <DialogDescription className="text-right">
              עדכן את פרטי המשתמש. שדה הרשאות מנוהל בנפרד.
            </DialogDescription>
          </DialogHeader>
          {editingUser && (
            <form onSubmit={handleEditSubmit} className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit_name" className="text-right">
                  שם מלא
                </Label>
                <Input
                  id="edit_name"
                  value={editingUser.full_name}
                  onChange={(e) =>
                    setEditingUser({
                      ...editingUser,
                      full_name: e.target.value,
                    })
                  }
                  className="text-right"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_dept" className="text-right">
                  מחלקה
                </Label>
                <Select
                  value={editingUser.department}
                  onValueChange={(val) =>
                    setEditingUser({ ...editingUser, department: val })
                  }
                  required
                >
                  <SelectTrigger className="w-full text-right" dir="rtl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="א">מחלקה א</SelectItem>
                    <SelectItem value="מ">מחלקה מ</SelectItem>
                    <SelectItem value="ת">מחלקה ת</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit_email" className="text-right">
                  כתובת מייל
                </Label>
                <Input
                  id="edit_email"
                  value={editingUser.email}
                  onChange={(e) =>
                    setEditingUser({ ...editingUser, email: e.target.value })
                  }
                  dir="ltr"
                  className="text-left"
                  required
                />
              </div>
            </form>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setIsEditUserOpen(false)}>
              ביטול
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={isSubmitting}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {isSubmitting ? "שומר..." : "שמור שינויים"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- 3. PERMISSIONS MODAL --- */}
      <Dialog open={isPermissionsOpen} onOpenChange={setIsPermissionsOpen}>
        <DialogContent className="sm:max-w-[680px] text-right" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <div className="bg-purple-100 p-2 rounded-full">
                <Shield className="w-5 h-5 text-purple-600" />
              </div>
              ניהול הרשאות
            </DialogTitle>
            <DialogDescription className="text-right">
              בחר את רמת ההרשאה עבור <b>{permissionUser?.full_name}</b>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
            {/* None Option */}
            <div
              onClick={() => setSelectedPermission("None")}
              className={`cursor-pointer rounded-xl border-2 p-4 transition-all relative overflow-hidden group
                ${selectedPermission === "None" ? "border-red-500 bg-red-50" : "border-gray-200 hover:border-red-200 hover:bg-gray-50"}
              `}
            >
              <div className="flex flex-col items-center text-center gap-3">
                <Ban className="w-12 h-12 text-red-400" />
                <h3 className="font-bold text-gray-800">ללא גישה (None)</h3>
                <p className="text-xs text-gray-500 leading-tight">
                  אינו מאפשר כניסה למערכת כלל
                </p>
              </div>
              {selectedPermission === "None" && (
                <div className="absolute top-2 right-2 text-red-600">
                  <Check className="w-5 h-5" />
                </div>
              )}
            </div>

            {/* Viewer Option */}
            <div
              onClick={() => setSelectedPermission("Viewer")}
              className={`cursor-pointer rounded-xl border-2 p-4 transition-all relative overflow-hidden group
                ${selectedPermission === "Viewer" ? "border-slate-400 bg-slate-50" : "border-gray-200 hover:border-slate-200 hover:bg-gray-50"}
              `}
            >
              <div className="flex flex-col items-center text-center gap-3">
                <Eye className="w-12 h-12 text-slate-400" />
                <h3 className="font-bold text-gray-800">צפייה בלבד (Viewer)</h3>
                <p className="text-xs text-gray-500 leading-tight">
                  מאפשר צפייה בלבד — ללא לקיחת או שינוי משמרות
                </p>
              </div>
              {selectedPermission === "Viewer" && (
                <div className="absolute top-2 right-2 text-slate-600">
                  <Check className="w-5 h-5" />
                </div>
              )}
            </div>

            {/* RR Option */}
            <div
              onClick={() => setSelectedPermission("RR")}
              className={`cursor-pointer rounded-xl border-2 p-4 transition-all relative overflow-hidden group
                ${selectedPermission === "RR" ? "border-orange-400 bg-orange-50" : "border-gray-200 hover:border-orange-200 hover:bg-gray-50"}
              `}
            >
              <div className="flex flex-col items-center text-center gap-3">
                <img
                  src="https://cdn-icons-png.flaticon.com/128/4133/4133589.png"
                  alt="RR"
                  className="w-12 h-12"
                />
                <h3 className="font-bold text-gray-800">משתמש רגיל (RR)</h3>
                <p className="text-xs text-gray-500 leading-tight">
                  מאפשר צפייה וביצוע פעולות במערכת
                </p>
              </div>
              {selectedPermission === "RR" && (
                <div className="absolute top-2 right-2 text-orange-500">
                  <Check className="w-5 h-5" />
                </div>
              )}
            </div>

            {/* Manager Option */}
            <div
              onClick={() => setSelectedPermission("Manager")}
              className={`cursor-pointer rounded-xl border-2 p-4 transition-all relative overflow-hidden group
                ${selectedPermission === "Manager" ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:border-blue-200 hover:bg-gray-50"}
              `}
            >
              <div className="flex flex-col items-center text-center gap-3">
                <img
                  src="https://cdn-icons-png.flaticon.com/512/10691/10691841.png"
                  alt="Manager"
                  className="w-12 h-12"
                />
                <h3 className="font-bold text-gray-800">מנהל (Manager)</h3>
                <p className="text-xs text-gray-500 leading-tight">
                  מאפשר צפייה, ביצוע פעולות וניהול המערכת
                </p>
              </div>
              {selectedPermission === "Manager" && (
                <div className="absolute top-2 right-2 text-blue-500">
                  <Check className="w-5 h-5" />
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setIsPermissionsOpen(false)}
            >
              ביטול
            </Button>
            <Button
              onClick={handleSavePermissions}
              disabled={isSubmitting}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {isSubmitting ? "מעדכן..." : "שמור הרשאות"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- 3C. SIGN EDIT MODAL --- */}
      <Dialog open={isSignOpen} onOpenChange={setIsSignOpen}>
        <DialogContent className="sm:max-w-[425px] text-right" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <div className="bg-gray-100 p-2 rounded-full">
                <Tag className="w-5 h-5 text-gray-600" />
              </div>
              עריכת קבוצה
            </DialogTitle>
            <DialogDescription className="text-right">
              עדכן את הקבוצה עבור <b>{signUser?.full_name}</b>.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="sign_value" className="text-right">
                קבוצה
              </Label>
              <Select
                value={signValue || undefined}
                onValueChange={setSignValue}
                dir="rtl"
              >
                <SelectTrigger id="sign_value" className="text-right">
                  <SelectValue placeholder="בחרו קבוצה" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— ללא קבוצה —</SelectItem>
                  {groupSymbols.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-gray-400 text-center">
                      אין קבוצות — צרו קבוצות בלשונית "ניהול קבוצות"
                    </div>
                  ) : (
                    groupSymbols.map((s) => (
                      <SelectItem key={s} value={s}>
                        קבוצה {s}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setIsSignOpen(false)}>
              ביטול
            </Button>
            <Button
              onClick={handleSaveSign}
              disabled={isSubmitting}
              className="bg-gray-700 hover:bg-gray-800 text-white"
            >
              {isSubmitting ? "שומר..." : "שמור קבוצה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- 3C-i. ADD GROUP MODAL --- */}
      <Dialog
        open={addGroupOpen}
        onOpenChange={(o) => {
          setAddGroupOpen(o);
          if (!o) setNewGroupName("");
        }}
      >
        <DialogContent
          className="sm:max-w-[420px] text-right"
          dir="rtl"
          closePosition="left-4 top-4"
        >
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <div className="bg-blue-100 p-2 rounded-full">
                <Plus className="w-5 h-5 text-blue-600" />
              </div>
              הוספת קבוצה חדשה
            </DialogTitle>
            <DialogDescription className="text-right">
              הזינו שם ייחודי לקבוצה חדשה.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAddGroup();
              }}
              placeholder="שם קבוצה חדשה..."
            />
            {newGroupDuplicate && (
              <p className="text-xs text-red-500 mt-2">
                קבוצה בשם זה כבר קיימת.
              </p>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAddGroupOpen(false);
                setNewGroupName("");
              }}
            >
              ביטול
            </Button>
            <Button
              disabled={
                !trimmedNewGroup ||
                newGroupDuplicate ||
                addGroupMutation.isPending
              }
              onClick={submitAddGroup}
              className="gap-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Plus className="w-4 h-4" />
              {addGroupMutation.isPending ? "מוסיף..." : "הוסף קבוצה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- 3D. SCHEDULE ACTIVE-MEMBER SWITCH MODAL --- */}
      <Dialog
        open={!!switchDialogSymbol}
        onOpenChange={(o) => {
          if (!o) {
            setSwitchDialogSymbol(null);
            setSwitchTargetSerial("");
            setSwitchDate("");
            setSwitchMode("switch");
          }
        }}
      >
        <DialogContent
          className="sm:max-w-[440px] text-right"
          dir="rtl"
          closePosition="left-4 top-4"
        >
          {(() => {
            const symbol = switchDialogSymbol;
            const seg = symbol ? activeGroupBySymbol.get(symbol) : null;
            const currentActiveSerial = activeMemberSerialIdOnDate(
              seg,
              todayKey(),
            );
            const members = symbol ? membersBySymbol.get(symbol) || [] : [];
            const currentActiveName =
              currentActiveSerial != null
                ? members.find(
                    (m) => Number(m.serial_id) === Number(currentActiveSerial),
                  )?.full_name || `#${currentActiveSerial}`
                : null;
            const isDeactivateMode = switchMode === "deactivate";
            const targetSelected = switchTargetSerial !== "";
            const sameAsActive =
              targetSelected &&
              currentActiveSerial != null &&
              Number(switchTargetSerial) === Number(currentActiveSerial);
            const isValid = isDeactivateMode
              ? !!switchDate
              : targetSelected && !!switchDate && !sameAsActive;
            return (
              <>
                <DialogHeader className="text-right">
                  <DialogTitle className="flex items-center gap-2 text-xl">
                    <div className="bg-blue-100 p-2 rounded-full">
                      <CalendarDays className="w-5 h-5 text-blue-600" />
                    </div>
                    תזמון שינוי — קבוצה {symbol}
                  </DialogTitle>
                  <DialogDescription className="text-right">
                    {isDeactivateMode
                      ? "מהתאריך שנבחר, לא יהיה משתמש פעיל בקבוצה — הקבוצה לא תשובץ למשמרות חדשות מאותו תאריך ואילך."
                      : "מהתאריך שנבחר, המשתמש הנכנס יהפוך לפעיל בקבוצה — משמרות מאותו תאריך ואילך ישויכו אליו (במקום למשתמש הפעיל הנוכחי), ולא יסומנו כמשובצות למי שאינו פעיל."}
                  </DialogDescription>
                </DialogHeader>
                <div className="py-2 space-y-3">
                  <div className="text-xs text-gray-500">
                    משתמש פעיל נוכחי:{" "}
                    <b className="text-gray-700">
                      {currentActiveName || "אין"}
                    </b>
                  </div>
                  {/* Mode toggle: switch to another member, or deactivate the group */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSwitchMode("switch")}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                        !isDeactivateMode
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                      }`}
                    >
                      החלפה למשתמש אחר
                    </button>
                    <button
                      type="button"
                      onClick={() => setSwitchMode("deactivate")}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                        isDeactivateMode
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                      }`}
                    >
                      ביטול פעיל (ללא פעיל)
                    </button>
                  </div>
                  {!isDeactivateMode && (
                    <div className="grid gap-1">
                      <Label className="text-sm text-gray-700">
                        משתמש נכנס (יהפוך לפעיל)
                      </Label>
                      <Select
                        value={switchTargetSerial}
                        onValueChange={setSwitchTargetSerial}
                        dir="rtl"
                      >
                        <SelectTrigger className="rounded-xl">
                          <SelectValue placeholder="בחר משתמש מהקבוצה" />
                        </SelectTrigger>
                        <SelectContent>
                          {members.filter((m) => m.serial_id != null).length ===
                          0 ? (
                            <div className="px-3 py-2 text-xs text-gray-400">
                              אין חברים בקבוצה
                            </div>
                          ) : (
                            members
                              .filter((m) => m.serial_id != null)
                              .map((m) => (
                                <SelectItem
                                  key={m.id}
                                  value={String(m.serial_id)}
                                  disabled={
                                    currentActiveSerial != null &&
                                    Number(m.serial_id) ===
                                      Number(currentActiveSerial)
                                  }
                                >
                                  {m.full_name}
                                  {currentActiveSerial != null &&
                                  Number(m.serial_id) ===
                                    Number(currentActiveSerial)
                                    ? " (פעיל כעת)"
                                    : ""}
                                </SelectItem>
                              ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="grid gap-1">
                    <Label className="text-sm text-gray-700">
                      {isDeactivateMode
                        ? "תאריך ביטול הפעיל"
                        : "תאריך ההחלפה"}
                    </Label>
                    <DateInputIL
                      value={switchDate}
                      onChange={setSwitchDate}
                      className="rounded-xl"
                    />
                  </div>
                  {!isDeactivateMode && sameAsActive && (
                    <p className="text-xs text-red-500">
                      יש לבחור משתמש שונה מהמשתמש הפעיל הנוכחי.
                    </p>
                  )}
                </div>
                <DialogFooter className="flex-col sm:flex-row gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSwitchDialogSymbol(null);
                      setSwitchTargetSerial("");
                      setSwitchDate("");
                      setSwitchMode("switch");
                    }}
                  >
                    ביטול
                  </Button>
                  <Button
                    disabled={!isValid || scheduleSwitchMutation.isPending}
                    onClick={() =>
                      scheduleSwitchMutation.mutate({
                        symbol,
                        targetSerialId: switchTargetSerial,
                        date: switchDate,
                        deactivate: isDeactivateMode,
                      })
                    }
                    className="gap-1 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <CalendarDays className="w-4 h-4" />
                    {scheduleSwitchMutation.isPending
                      ? "שומר..."
                      : isDeactivateMode
                      ? "תזמן ביטול פעיל"
                      : "תזמן החלפה"}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* --- 3D. ADD MEMBERS TO GROUP MODAL --- */}
      <Dialog
        open={!!groupPickerSymbol}
        onOpenChange={(o) => {
          if (!o) {
            setGroupPickerSymbol(null);
            setGroupPickerSelected([]);
            setGroupPickerSearch("");
          }
        }}
      >
        <DialogContent
          className="sm:max-w-[480px] text-right"
          dir="rtl"
          closePosition="left-4 top-4"
        >
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <div className="bg-blue-100 p-2 rounded-full">
                <UserPlus className="w-5 h-5 text-blue-600" />
              </div>
              הוספת משתמשים לקבוצה {groupPickerSymbol}
            </DialogTitle>
            <DialogDescription className="text-right">
              הקבוצה של המשתמשים שייבחרו תשתנה ל-<b>{groupPickerSymbol}</b>.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <div className="relative mb-2">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="חיפוש לפי שם או מייל..."
                value={groupPickerSearch}
                onChange={(e) => setGroupPickerSearch(e.target.value)}
                className="pr-10"
              />
            </div>
            <div className="max-h-64 overflow-y-auto flex flex-col gap-1 custom-scrollbar">
              {groupPickerCandidates.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  אין משתמשים זמינים להוספה
                </p>
              ) : (
                groupPickerCandidates.map((p) => {
                  const checked = groupPickerSelected.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        setGroupPickerSelected((prev) =>
                          checked
                            ? prev.filter((id) => id !== p.id)
                            : [...prev, p.id],
                        )
                      }
                      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 border text-right transition-colors ${
                        checked
                          ? "bg-blue-50 border-blue-300"
                          : "bg-white border-gray-100 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium text-gray-800 truncate">
                          {p.full_name}
                        </span>
                        <span className="text-xs text-gray-400 font-mono truncate">
                          {p.email}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {p.sign && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                            קבוצה {p.sign}
                          </span>
                        )}
                        {checked && <Check className="w-4 h-4 text-blue-600" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setGroupPickerSymbol(null);
                setGroupPickerSelected([]);
                setGroupPickerSearch("");
              }}
            >
              ביטול
            </Button>
            <Button
              disabled={
                groupPickerSelected.length === 0 ||
                addUsersToGroupMutation.isPending
              }
              onClick={() =>
                addUsersToGroupMutation.mutate({
                  symbol: groupPickerSymbol,
                  personIds: groupPickerSelected,
                })
              }
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {addUsersToGroupMutation.isPending
                ? "מוסיף..."
                : `הוסף (${groupPickerSelected.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- 3E. DELETE GROUP MODAL --- */}
      <Dialog
        open={!!groupToDelete}
        onOpenChange={(o) => {
          if (!o) setGroupToDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-[400px] text-right" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-xl text-red-600">
              <div className="bg-red-100 p-2 rounded-full">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              הסרת קבוצה
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-gray-600">
              להסיר את קבוצה <b>{groupToDelete}</b>? שיוך הקבוצה יימחק מכל חברי
              הקבוצה
              {(() => {
                const n = authorizedPeople.filter(
                  (p) => p.sign === groupToDelete,
                ).length;
                return n > 0 ? ` (${n} משתמשים)` : "";
              })()}
              .
            </p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setGroupToDelete(null)}>
              ביטול
            </Button>
            <Button
              disabled={removeGroupMutation.isPending}
              onClick={() => removeGroupMutation.mutate(groupToDelete)}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {removeGroupMutation.isPending ? "מסיר..." : "הסר קבוצה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- 3F. REMOVE MEMBER FROM GROUP MODAL --- */}
      <Dialog
        open={!!memberToRemove}
        onOpenChange={(o) => {
          if (!o) setMemberToRemove(null);
        }}
      >
        <DialogContent className="sm:max-w-[400px] text-right" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-xl text-red-600">
              <div className="bg-red-100 p-2 rounded-full">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              הסרת חבר מקבוצה
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-gray-600">
              להסיר את <b>{memberToRemove?.person?.full_name}</b> מקבוצה{" "}
              <b>{memberToRemove?.symbol}</b>? שיוך הקבוצה שלו יימחק.
            </p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setMemberToRemove(null)}>
              ביטול
            </Button>
            <Button
              disabled={removeFromGroupMutation.isPending}
              onClick={() =>
                removeFromGroupMutation.mutate(
                  { person: memberToRemove.person },
                  { onSuccess: () => setMemberToRemove(null) },
                )
              }
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {removeFromGroupMutation.isPending ? "מסיר..." : "הסר מהקבוצה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- 4. DELETE / ARCHIVE MODAL --- */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-[400px] text-right" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-xl text-red-600">
              <div className="bg-red-100 p-2 rounded-full">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              {isArchiveMode ? "העברה לארכיון" : "מחיקת משתמש"}
            </DialogTitle>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {!isArchiveMode ? (
              <p className="text-gray-600">
                האם הנך בטוח שברצונך להסיר את <b>{userToDelete?.full_name}</b>{" "}
                מהמערכת?
                <br />
                פעולה זו אינה הפיכה.
              </p>
            ) : (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
              >
                <Label className="mb-2 block text-gray-700">
                  סיבת העברה לארכיון:
                </Label>
                <Textarea
                  value={archiveReason}
                  onChange={(e) => setArchiveReason(e.target.value)}
                  placeholder="הכנס סיבה או הערה..."
                  className="bg-gray-50 focus:bg-white min-h-[80px]"
                />
              </motion.div>
            )}
          </div>

          <DialogFooter className="flex flex-col gap-2 w-full">
            <div className="flex gap-2 w-full">
              <Button
                onClick={handleDeleteConfirm}
                disabled={isSubmitting}
                className={`flex-1 ${isArchiveMode ? "bg-orange-500 hover:bg-orange-600" : "bg-red-600 hover:bg-red-700"} text-white`}
              >
                {isSubmitting
                  ? "מעבד..."
                  : isArchiveMode
                    ? "העבר לארכיון"
                    : "כן, מחיקה"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsDeleteOpen(false)}
                className="flex-1"
              >
                לא, ביטול
              </Button>
            </div>

            {/* Archive Toggle Button (Only visible if not already in archive mode) */}
            {!isArchiveMode && (
              <Button
                variant="ghost"
                onClick={() => setIsArchiveMode(true)}
                className="w-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 gap-2 mt-2"
              >
                <Archive className="w-4 h-4" /> אפשרויות ארכיון
              </Button>
            )}

            {/* Cancel Archive Mode (Go back to delete) */}
            {isArchiveMode && (
              <Button
                variant="ghost"
                onClick={() => setIsArchiveMode(false)}
                className="w-full text-sm text-gray-400 hover:text-gray-600"
              >
                חזרה למחיקה רגילה
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- DELETE SHIFTS IN RANGE CONFIRMATION --- */}
      <Dialog
        open={isDeleteShiftsConfirmOpen}
        onOpenChange={setIsDeleteShiftsConfirmOpen}
      >
        <DialogContent className="sm:max-w-[400px] text-right" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-xl text-red-600">
              <div className="bg-red-100 p-2 rounded-full">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              מחיקת משמרות
            </DialogTitle>
          </DialogHeader>

          <div className="py-4">
            <p className="text-gray-600">
              האם הנך בטוח שברצונך למחוק{" "}
              <b>{shiftsInDeleteRange.length} משמרות</b> בטווח{" "}
              <span dir="ltr">
                {deleteShiftsRange.startDate &&
                  format(
                    new Date(deleteShiftsRange.startDate),
                    "dd/MM/yyyy",
                  )}{" "}
                -{" "}
                {deleteShiftsRange.endDate &&
                  format(new Date(deleteShiftsRange.endDate), "dd/MM/yyyy")}
              </span>
              ?
              <br />
              פעולה זו אינה הפיכה.
            </p>
          </div>

          <DialogFooter className="flex gap-2 w-full">
            <Button
              onClick={handleConfirmDeleteShiftsRange}
              disabled={deleteShiftsRangeMutation.isPending}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white"
            >
              {deleteShiftsRangeMutation.isPending ? "מוחק..." : "כן, מחיקה"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setIsDeleteShiftsConfirmOpen(false)}
              disabled={deleteShiftsRangeMutation.isPending}
              className="flex-1"
            >
              לא, ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- REPLACE SHIFTS BETWEEN USERS CONFIRMATION --- */}
      <Dialog
        open={isReplaceShiftsConfirmOpen}
        onOpenChange={setIsReplaceShiftsConfirmOpen}
      >
        <DialogContent className="sm:max-w-[420px] text-right" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-xl text-blue-600">
              <div className="bg-blue-100 p-2 rounded-full">
                <ArrowLeftRight className="w-5 h-5 text-blue-600" />
              </div>
              החלפת משמרות בין משתמשים
            </DialogTitle>
          </DialogHeader>

          <div className="py-4">
            <p className="text-gray-600">
              להעביר <b>{shiftsInReplaceRange.length} משמרות</b> מ־
              <b>
                {
                  authorizedPeople.find(
                    (p) =>
                      Number(p.serial_id) ===
                      Number(replaceShiftsForm.fromUserId),
                  )?.full_name
                }
              </b>{" "}
              אל{" "}
              <b>
                {
                  authorizedPeople.find(
                    (p) =>
                      Number(p.serial_id) ===
                      Number(replaceShiftsForm.toUserId),
                  )?.full_name
                }
              </b>{" "}
              בטווח{" "}
              <span dir="ltr">
                {replaceShiftsForm.startDate &&
                  format(
                    new Date(replaceShiftsForm.startDate),
                    "dd/MM/yyyy",
                  )}{" "}
                -{" "}
                {replaceShiftsForm.endDate &&
                  format(new Date(replaceShiftsForm.endDate), "dd/MM/yyyy")}
              </span>
              ?
            </p>
          </div>

          <DialogFooter className="flex gap-2 w-full">
            <Button
              onClick={handleConfirmReplaceShifts}
              disabled={replaceShiftsMutation.isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {replaceShiftsMutation.isPending ? "מחליף..." : "כן, החלף"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setIsReplaceShiftsConfirmOpen(false)}
              disabled={replaceShiftsMutation.isPending}
              className="flex-1"
            >
              לא, ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Offer to migrate the outgoing active member's future shifts to the
          incoming one, after a group's active member was changed. */}
      <Dialog
        open={!!pendingShiftMigration}
        onOpenChange={(open) => !open && setPendingShiftMigration(null)}
      >
        <DialogContent className="sm:max-w-[420px] text-right" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-xl text-blue-600">
              <div className="bg-blue-100 p-2 rounded-full">
                <ArrowLeftRight className="w-5 h-5 text-blue-600" />
              </div>
              העברת משמרות עתידיות
            </DialogTitle>
          </DialogHeader>

          {pendingShiftMigration && (
            <div className="py-4 space-y-4">
              <p className="text-gray-600">
                המשתמש הפעיל של הקבוצה שונה. להעביר את{" "}
                <b>{pendingShiftMigration.shiftIds.length} המשמרות העתידיות</b>{" "}
                שמשויכות למשתמש הקודם, כך שיהיו בבעלות המשתמש הפעיל החדש?
              </p>
              <div className="flex items-center justify-center gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-3">
                <span className="font-semibold text-gray-700">
                  {pendingShiftMigration.previousPerson.full_name}
                </span>
                <ArrowLeft className="w-5 h-5 text-blue-600 shrink-0" />
                <span className="font-semibold text-blue-700">
                  {pendingShiftMigration.newPerson.full_name}
                </span>
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2 w-full">
            <Button
              onClick={() =>
                migrateFutureShiftsMutation.mutate({
                  shiftIds: pendingShiftMigration.shiftIds,
                  toUserId: pendingShiftMigration.newPerson.serial_id,
                })
              }
              disabled={migrateFutureShiftsMutation.isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {migrateFutureShiftsMutation.isPending
                ? "מעביר..."
                : "כן, העבר משמרות"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setPendingShiftMigration(null)}
              disabled={migrateFutureShiftsMutation.isPending}
              className="flex-1"
            >
              לא, השאר כפי שהוא
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatePresence>
  );
}
