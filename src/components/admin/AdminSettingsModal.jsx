import React, { useMemo, useState } from "react";
import { format } from "date-fns";
import { distributeShifts } from "../calendar/shiftDistributionAlgorithm";
import { useHolidays } from "../calendar/useHolidays";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Search,
  Filter,
  MoreVertical,
  Edit2,
  Trash2,
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
  UserCheck,
  FlaskConical,
  XCircle,
  Download,
  Tag,
  Users,
  Star,
  UserMinus,
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
import { base44 } from "@/api/base44Client";
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
  MONITOR_CHECKS,
  LOG_TYPE_OPTIONS,
  DEFAULT_GROUP_SYMBOLS,
} from "@/components/admin/adminConstants";

// A native <input type="date"> keeps the OS/browser date picker (calendar
// icon, click-to-pick, keyboard entry) — only its DISPLAYED format is
// locale-dependent, which is what made it show up as mm/dd/yyyy for some
// users. Setting lang="en-GB" on the input forces the dd/mm/yyyy display
// Israeli users expect, in every Chromium/Firefox browser, while .value
// keeps emitting/accepting the same 'yyyy-MM-dd' string as before.
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

export default function AdminSettingsModal({ isOpen, onClose }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDepartments, setSelectedDepartments] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("users");
  const [systemStatus, setSystemStatus] = useState(true);
  const [systemSettings, setSystemSettings] = useState({
    // הטקסטים בפועל שמוצגים תחת הלוגו ב-CalendarHeader.jsx
    title: "מערכת לניהול משמרות",
    subtitle: "צפייה במשמרות | ביצוע החלפות מסודרות",
    keywords: "Razarto, משמרות, החלפות",
    offlineMessage: "המערכת כרגע בתחזוקה מתוכננת. חזרו בעוד מספר דקות.",
  });
  const [supportSettings, setSupportSettings] = useState({
    // אין כרגע מדריך שימוש אמיתי — ה-HelpSupportModal מציג הודעת "בקרוב" בלבד.
    guideUrl: "",
    // ה-embed בפועל ב-HelpSupportModal.jsx (מזהה סרטון YouTube)
    videoUrl: "https://youtu.be/9u12tJQ1KF4",
    // מספרי הוואטסאפ האמיתיים שמוזמנים בפועל מתוך HelpSupportModal.jsx
    permissionsPhone: "+972 54-688-1831",
    issuesPhone: "+972 53-622-1840",
  });
  // --- MODAL STATES ---
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [addUserStep, setAddUserStep] = useState("form"); // 'form' or 'success'
  const [addedUserData, setAddedUserData] = useState(null); // Stores the newly added user for the invite

  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [isPermissionsOpen, setIsPermissionsOpen] = useState(false);
  const [isRoleOpen, setIsRoleOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // --- DATA STATES ---
  const [newUser, setNewUser] = useState({
    full_name: "",
    department: "",
    email: "",
    permissions: "View",
  });
  const [editingUser, setEditingUser] = useState(null);
  const [permissionUser, setPermissionUser] = useState(null);
  const [selectedPermission, setSelectedPermission] = useState("");
  const [roleUser, setRoleUser] = useState(null);
  const [selectedRole, setSelectedRole] = useState("");
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
  // Add-group input, and the group pending a delete confirmation.
  const [newGroupSymbol, setNewGroupSymbol] = useState("");
  const [groupToDelete, setGroupToDelete] = useState(null);

  // Archive Logic States
  const [isArchiveMode, setIsArchiveMode] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");

  // --- Fair shift distribution (tasks.txt #4) ---
  const [distributionRange, setDistributionRange] = useState({
    startDate: "",
    endDate: "",
  });
  const [distributionResult, setDistributionResult] = useState(null);
  const [distributionError, setDistributionError] = useState("");

  // --- Delete shifts in a date range ---
  const [deleteShiftsRange, setDeleteShiftsRange] = useState({
    startDate: "",
    endDate: "",
  });
  const [deleteShiftsError, setDeleteShiftsError] = useState("");
  const [isDeleteShiftsConfirmOpen, setIsDeleteShiftsConfirmOpen] =
    useState(false);

  // --- System test suite (src/lib/testing) ---
  const [testResults, setTestResults] = useState(null);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [showTestExportGate, setShowTestExportGate] = useState(false);

  const queryClient = useQueryClient();

  const monitorChecks = MONITOR_CHECKS;

  // --- HELPER: Permission Colors ---
  const getPermissionStyle = (perm) => {
    switch (perm) {
      case "RR":
        return { bg: "#fde4cf", text: "#5d3a1a", border: "#e8cdb3" };
      case "View":
        return { bg: "#f1c0e8", text: "#682a5c", border: "#dcb0d4" };
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

  // Group "active member" records (repurposed ShiftSegment entity): one row per
  // group symbol that currently has an active member — { symbol, username
  // (active member's email), active }. Drives the "ניהול קבוצות" tab and gates
  // shift distribution (only active members are assigned shifts).
  const { data: shiftSegments = [] } = useQuery({
    queryKey: ["shift-segments"],
    queryFn: () => base44.entities.ShiftSegment.list(),
    enabled: isOpen,
  });

  // symbol -> the ShiftSegment row for that group (holds its active member, if
  // any). Each ShiftSegment row now IS a group definition.
  const activeSegmentBySymbol = useMemo(() => {
    const map = new Map();
    shiftSegments.forEach((seg) => {
      if (seg.symbol) map.set(seg.symbol, seg);
    });
    return map;
  }, [shiftSegments]);

  // The live list of groups: every ShiftSegment symbol, plus any symbol already
  // referenced by a user's `sign` (so pre-existing groups without a row still
  // appear). Sorted with Hebrew collation. This replaces the old fixed list.
  const groupSymbols = useMemo(() => {
    const set = new Set();
    shiftSegments.forEach((seg) => seg.symbol && set.add(seg.symbol));
    authorizedPeople.forEach((p) => p.sign && set.add(p.sign));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "he"));
  }, [shiftSegments, authorizedPeople]);

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
  const logoUrl = appSettings.find((s) => s.setting_key === "logo")?.logo_url || "";
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const updateLogoMutation = useMutation({
    mutationFn: async (url) => {
      const existing = appSettings.find((s) => s.setting_key === "logo");
      if (existing) {
        return base44.entities.AppSettings.update(existing.id, { logo_url: url });
      }
      return base44.entities.AppSettings.create({
        setting_key: "logo",
        logo_url: url,
      });
    },
    onSuccess: () => {
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

  // Fetches all shifts (shares the ['shifts'] cache with the rest of the app),
  // but shiftDistributionAlgorithm only ever looks at the ones that fall
  // inside the chosen [startDate, endDate] range — it has no dependency on
  // shift history from before the range.
  const { data: allShiftsForDistribution = [] } = useQuery({
    queryKey: ["shifts"],
    queryFn: () => base44.entities.Shift.list(),
    enabled: isOpen,
  });

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
        // Every user entering the system defaults to role 'RR' (allowed to
        // take shifts) — managers can flip individuals to 'None' afterwards
        // via "ניהול תפקיד".
        role: "RR",
        ...userData,
        serial_id: maxId + 1,
        // No group ("sign") on creation — a new user is assigned to one of the
        // 24 groups later from the "ניהול קבוצות" tab (or "עריכת סימן").
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
      queryClient.invalidateQueries(["authorized-people"]);
      // Instead of closing, switch to success step
      setAddedUserData(data);
      setAddUserStep("success");
      setNewUser({
        full_name: "",
        department: "",
        email: "",
        permissions: "View",
      }); // Reset form
    },
    onError: () => toast.error("שגיאה בהוספת המשתמש."),
  });

  // 2. Update User
  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      return await base44.entities.AuthorizedPerson.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["authorized-people"]);
      toast.success("הפרטים עודכנו בהצלחה!");
      setIsEditUserOpen(false);
      setIsPermissionsOpen(false);
      setIsRoleOpen(false);
      setIsSignOpen(false);
    },
    onError: () => toast.error("שגיאה בעדכון הפרטים."),
  });

  // 3. Delete User
  const deleteUserMutation = useMutation({
    mutationFn: async (id) => {
      return await base44.entities.AuthorizedPerson.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["authorized-people"]);
      toast.success("המשתמש הוסר מהמערכת בהצלחה.");
      setIsDeleteOpen(false);
      setUserToDelete(null);
    },
    onError: () => toast.error("שגיאה במחיקת המשתמש."),
  });

  // 3b. Groups — set a group's active member. Only one member per group may be
  // active (or none): the group's single ShiftSegment row points its `username`
  // at the active member's email. Passing person=null (or clicking the
  // already-active member) clears the active member WITHOUT deleting the row —
  // the row is the group definition itself, so it must survive. The active
  // member must belong to the group already.
  const setActiveMemberMutation = useMutation({
    mutationFn: async ({ symbol, person }) => {
      const existing = activeSegmentBySymbol.get(symbol);
      const clearing =
        !person || (existing?.active && existing?.username === person.email);
      if (clearing) {
        if (existing) {
          await base44.entities.ShiftSegment.update(existing.id, {
            username: null,
            active: false,
          });
        }
        return;
      }
      if (existing) {
        await base44.entities.ShiftSegment.update(existing.id, {
          username: person.email,
          active: true,
        });
      } else {
        // Group referenced only by members' `sign` and no row yet — create it.
        await base44.entities.ShiftSegment.create({
          symbol,
          username: person.email,
          active: true,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shift-segments"]);
    },
    onError: () => toast.error("שגיאה בעדכון המשתמש הפעיל בקבוצה."),
  });

  // 3b-i. Groups — add a new group (a ShiftSegment row with just a symbol).
  const addGroupMutation = useMutation({
    mutationFn: async (symbol) => {
      const trimmed = (symbol || "").trim();
      if (!trimmed) throw new Error("empty");
      if (groupSymbols.includes(trimmed)) throw new Error("duplicate");
      await base44.entities.ShiftSegment.create({
        symbol: trimmed,
        active: false,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shift-segments"]);
      toast.success("הקבוצה נוספה.");
      setNewGroupSymbol("");
    },
    onError: (err) => {
      if (err?.message === "duplicate") toast.error("קבוצה בשם זה כבר קיימת.");
      else if (err?.message === "empty") toast.error("יש להזין שם קבוצה.");
      else toast.error("שגיאה בהוספת הקבוצה.");
    },
  });

  // 3b-ii. Groups — remove a group entirely: delete its ShiftSegment row (if
  // any) and clear `sign` from every member so no user points at a dead group.
  const removeGroupMutation = useMutation({
    mutationFn: async (symbol) => {
      const seg = activeSegmentBySymbol.get(symbol);
      if (seg) await base44.entities.ShiftSegment.delete(seg.id);
      const members = authorizedPeople.filter((p) => p.sign === symbol);
      await Promise.all(
        members.map((m) =>
          base44.entities.AuthorizedPerson.update(m.id, { sign: null }),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shift-segments"]);
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
          base44.entities.ShiftSegment.create({ symbol: s, active: false }),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shift-segments"]);
      toast.success("קבוצות ברירת המחדל נוצרו.");
    },
    onError: () => toast.error("שגיאה ביצירת קבוצות ברירת המחדל."),
  });

  // 3c. Groups — add one or more users to a group by setting their `sign` to
  // the group symbol (same effect as "עריכת סימן", in bulk).
  const addUsersToGroupMutation = useMutation({
    mutationFn: async ({ symbol, personIds }) => {
      await Promise.all(
        personIds.map((id) =>
          base44.entities.AuthorizedPerson.update(id, { sign: symbol }),
        ),
      );
    },
    onSuccess: (_data, { personIds }) => {
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
      const seg = person.sign ? activeSegmentBySymbol.get(person.sign) : null;
      if (seg && seg.active && seg.username === person.email) {
        await base44.entities.ShiftSegment.update(seg.id, {
          username: null,
          active: false,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["authorized-people"]);
      queryClient.invalidateQueries(["shift-segments"]);
      toast.success("המשתמש הוסר מהקבוצה.");
    },
    onError: () => toast.error("שגיאה בהסרת המשתמש מהקבוצה."),
  });

  // 4. Fair shift distribution — only RR and Manager permission holders are
  // in the rotation pool (Admins/View users are excluded from being
  // auto-assigned shifts by this algorithm).
  const runDistributionMutation = useMutation({
    mutationFn: async ({ startDate, endDate }) => {
      // Strict active-only rule: a person is assigned shifts only if they are
      // the active member of their group (a ShiftSegment row with active=true
      // whose username matches their email), on top of the existing RR/Manager
      // + role check. Users in no group, or non-active group members, are
      // excluded.
      const activeEmails = new Set(
        shiftSegments
          .filter((seg) => seg.active && seg.username)
          .map((seg) => seg.username),
      );
      const eligiblePeople = authorizedPeople.filter(
        (p) =>
          ["RR", "Manager"].includes(p.permissions) &&
          (p.role || "RR") !== "None" &&
          activeEmails.has(p.email),
      );
      if (eligiblePeople.length === 0) {
        throw new Error(
          "אין עובדים זכאים לחלוקה — נדרש משתמש פעיל בקבוצה (RR או Manager, עם תפקיד RR). הגדירו משתמשים פעילים בלשונית 'ניהול קבוצות'.",
        );
      }

      const holidayDates = new Set(Object.keys(holidaysByDate));

      const result = distributeShifts({
        people: eligiblePeople,
        existingShifts: allShiftsForDistribution,
        startDate,
        endDate,
        holidayDates,
        cholHamoedDates,
      });

      await Promise.all(
        result.assignments.map((a) =>
          base44.entities.Shift.create({
            start_date: a.date,
            end_date: a.date,
            start_time: "09:00",
            end_time: "09:00",
            original_user_id: a.personId,
            status: "Active",
          }),
        ),
      );

      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries(["shifts"]);
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
      await addUserMutation.mutateAsync(newUser);
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

  const handleSaveRole = async () => {
    if (!roleUser || !selectedRole) return;
    setIsSubmitting(true);
    try {
      await updateUserMutation.mutateAsync({
        id: roleUser.id,
        data: { role: selectedRole },
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
    return authorizedPeople.filter((person) => {
      const searchMatch =
        person.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        person.email?.toLowerCase().includes(searchTerm.toLowerCase());
      const deptMatch =
        selectedDepartments.length === 0 ||
        selectedDepartments.includes(person.department);
      return searchMatch && deptMatch;
    });
  };

  const filteredPeople = getFilteredPeople();

  const statusColors = {
    ok: "bg-emerald-500",
    warn: "bg-amber-400",
    error: "bg-rose-500",
  };

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
          <div className="flex flex-col gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-blue-600 font-semibold">
                system console
              </p>
              <h2 className="text-xl md:text-2xl font-bold text-gray-800">
                ניהול מערכת
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="w-6 h-6 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden bg-[#F9FAFB] p-3 md:p-5 flex flex-col gap-3 md:gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 shrink-0 flex flex-col p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 text-[11px] rounded-full bg-blue-50 text-blue-700 font-semibold border border-blue-100">
                  פאנל מודולארי
                </span>
                <span className="text-gray-400 text-xs hidden md:inline">
                  בחר את המודול לניהול
                </span>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 py-2" dir="rtl">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 md:px-4 py-2 rounded-xl border transition-all shrink-0 text-sm font-semibold
                    ${
                      activeTab === tab.id
                        ? "border-blue-500 bg-blue-50 text-blue-700 shadow-md shadow-blue-100"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }
                  `}
                >
                  {tab.Icon ? (
                    <tab.Icon className="w-4 h-4 md:w-5 md:h-5" />
                  ) : (
                    <img
                      src={tab.icon}
                      alt={tab.label}
                      className="w-4 h-4 md:w-5 md:h-5"
                    />
                  )}
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

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
                  <div className="col-span-1">תפקיד</div>
                  <div className="col-span-1">סימן</div>
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
                              </span>{" "}
                              •{" "}
                              <span
                                className={
                                  (person.role || "RR") === "RR"
                                    ? "text-emerald-600"
                                    : "text-gray-400"
                                }
                              >
                                {person.role || "RR"}
                              </span>
                              {person.sign && (
                                <>
                                  {" • "}
                                  <span className="text-gray-500 font-mono">
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
                              {person.permissions || "View"}
                            </span>
                          </div>

                          {/* Role (Styled: emerald for RR, gray for None) */}
                          <div className="hidden md:block col-span-1">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border shadow-sm ${
                                (person.role || "RR") === "RR"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-gray-100 text-gray-500 border-gray-200"
                              }`}
                            >
                              {person.role || "RR"}
                            </span>
                          </div>

                          {/* Sign */}
                          <div className="hidden md:block col-span-1">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border shadow-sm bg-gray-50 text-gray-700 border-gray-200 font-mono">
                              {person.sign || "—"}
                            </span>
                          </div>

                          {/* Connectivity */}
                          <div className="col-span-3 md:col-span-1 flex justify-center items-center">
                            <img
                              src={
                                person.linked_user_id
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
                                      person.permissions || "View",
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
                                    setRoleUser(person);
                                    setSelectedRole(person.role || "RR");
                                    setIsRoleOpen(true);
                                  }}
                                  className="flex items-center justify-end gap-2 cursor-pointer text-gray-700"
                                >
                                  <span>ניהול תפקיד</span>
                                  <UserCheck className="w-4 h-4" />
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSignUser(person);
                                    setSignValue(person.sign || "");
                                    setIsSignOpen(true);
                                  }}
                                  className="flex items-center justify-end gap-2 cursor-pointer text-gray-700"
                                >
                                  <span>עריכת סימן</span>
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

                <div className="p-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-500 flex justify-between px-6 shrink-0">
                  <span>סה"כ רשומות: {filteredPeople.length}</span>
                  <span className="hidden md:inline">
                    מציג {filteredPeople.length} מתוך {authorizedPeople.length}
                  </span>
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
                    לקבוצה (השדה "סימן"), ובכל קבוצה ניתן לסמן משתמש אחד בלבד
                    כ<b>פעיל</b> (או אף אחד) — מערכת חלוקת המשמרות תשבץ משמרות אך
                    ורק למשתמשים הפעילים.
                  </p>
                </div>
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addGroupMutation.mutate(newGroupSymbol);
                  }}
                >
                  <Input
                    value={newGroupSymbol}
                    onChange={(e) => setNewGroupSymbol(e.target.value)}
                    placeholder="שם קבוצה חדשה..."
                    className="h-9 max-w-xs"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      !newGroupSymbol.trim() || addGroupMutation.isPending
                    }
                    className="gap-1 bg-blue-600 hover:bg-blue-700 text-white h-9"
                  >
                    <Plus className="w-4 h-4" /> הוסף קבוצה
                  </Button>
                </form>
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
                  <div className="overflow-y-auto flex-1 min-h-0 custom-scrollbar p-3 md:p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {groupSymbols.map((symbol) => {
                    const members = membersBySymbol.get(symbol) || [];
                    const activeSeg = activeSegmentBySymbol.get(symbol);
                    const activeEmail = activeSeg?.active
                      ? activeSeg.username
                      : null;
                    // Only treat the group as "has active" when its active email
                    // still belongs to a current member of the group.
                    const hasActiveMember =
                      !!activeEmail &&
                      members.some((m) => m.email === activeEmail);
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
                                {hasActiveMember ? " · יש פעיל" : " · אין פעיל"}
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
                              title="הסר קבוצה"
                              className="h-8 w-8 text-gray-300 hover:text-red-500"
                              onClick={() => setGroupToDelete(symbol)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        {/* Members */}
                        {members.length === 0 ? (
                          <p className="text-xs text-gray-300 py-3 text-center">
                            אין חברים בקבוצה
                          </p>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {members.map((m) => {
                              const isActive =
                                activeEmail && m.email === activeEmail;
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
                                      title={isActive ? "בטל פעיל" : "סמן כפעיל"}
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
                                        removeFromGroupMutation.mutate({
                                          person: m,
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
                          לוגו נוכחי מוגדר — ניתן גם להחליף אותו בלחיצה על
                          הלוגו בפינה העליונה של האפליקציה.
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

              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      מוניטור
                    </p>
                    <p className="text-xs text-gray-500">
                      בדיקת שירותים בזמן אמת
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-emerald-600">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />{" "}
                    הכל תקין
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {monitorChecks.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-gradient-to-br from-white to-gray-50"
                    >
                      <span
                        className={`w-3 h-3 rounded-full ${statusColors[item.status]} animate-pulse`}
                      />
                      <div className="flex flex-col text-sm">
                        <span className="font-semibold text-gray-800">
                          {item.label}
                        </span>
                        <span className="text-xs text-gray-500">
                          {item.detail}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
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
                      קישור למדריך שימוש מלא
                    </Label>
                    <Input
                      value={supportSettings.guideUrl}
                      onChange={(e) =>
                        handleSupportChange("guideUrl", e.target.value)
                      }
                      placeholder="טרם קיים מדריך — כרגע מוצגת הודעת 'בקרוב' בעמוד התמיכה"
                      className="rounded-xl"
                      dir="ltr"
                    />
                  </div>
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
            </div>
          )}

          {activeTab === "themes" && <ThemesTab />}

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
                      (א'-ש'), שישי-שבת תמיד מוקצים יחד לאותו אדם, וכך גם ערב
                      חג וימי החג (למשל ערב חג שחל בחמישי — המשמרת נשארת אצל
                      אותו אדם עד שבת). ימי חול המועד (בסוכות ובפסח) לא נכללים
                      בצירוף הזה ומתחלקים כרגיל בין העובדים, כדי שמשמרת החג לא
                      תימשך יותר מדי אצל אדם אחד. הפיזור בין המשמרות של כל אדם
                      נשמר נוח ולא יום אחרי יום בטעות. הבחירה מתבססת על טבלת
                      "צדק" — עדיפות ניתנת לפי מספר המשמרות הנמוך ביותר שנצבר
                      בטווח שנבחר.
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
                      בקשות החלפה, ראש בראש, כיסוי חלקי, בקשה כללית, שיוך
                      מחדש, וחלוקת משמרות הוגנת) ומציג אם הם עוברים. חלק
                      מהבדיקות יוצרות משתמשים/משמרות/בקשות זמניים בפועל
                      במסד הנתונים (מסומנים בקידומת "[TEST]") ומוחקות אותם
                      אוטומטית בסיום כל בדיקה — נתונים אמיתיים לא נגעים בהם.
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
                      {testResults.filter((r) => r.status === "passed").length}
                      /{testResults.length} עברו בהצלחה
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
              משמרות ובקשות זמניים בפועל במסד הנתונים החי, ומוחקות אותם
              אוטומטית מיד בסיום כל בדיקה — נתונים אמיתיים לא נגעים בהם.
              ליתר ביטחון (למשל אם הדפדפן ייסגר באמצע ההרצה), מומלץ לייצא
              גיבוי של הנתונים לפני שממשיכים.
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
        <DialogContent className="sm:max-w-[425px] text-right" dir="rtl">
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
                      <SelectItem value="View">צפייה בלבד (View)</SelectItem>
                      <SelectItem value="RR">משתמש רגיל (RR)</SelectItem>
                      <SelectItem value="Manager">מנהל (Manager)</SelectItem>
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
        <DialogContent className="sm:max-w-[550px] text-right" dir="rtl">
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4">
            {/* View Option */}
            <div
              onClick={() => setSelectedPermission("View")}
              className={`cursor-pointer rounded-xl border-2 p-4 transition-all relative overflow-hidden group
                ${selectedPermission === "View" ? "border-purple-500 bg-purple-50" : "border-gray-200 hover:border-purple-200 hover:bg-gray-50"}
              `}
            >
              <div className="flex flex-col items-center text-center gap-3">
                <img
                  src="https://cdn-icons-png.flaticon.com/128/2235/2235419.png"
                  alt="View"
                  className="w-12 h-12"
                />
                <h3 className="font-bold text-gray-800">צפייה בלבד (View)</h3>
                <p className="text-xs text-gray-500 leading-tight">
                  מאפשר צפייה במערכת בלבד ללא ביצוע פעולות
                </p>
              </div>
              {selectedPermission === "View" && (
                <div className="absolute top-2 right-2 text-purple-600">
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

      {/* --- 3B. ROLE MODAL (can this person take shifts?) --- */}
      <Dialog open={isRoleOpen} onOpenChange={setIsRoleOpen}>
        <DialogContent className="sm:max-w-[500px] text-right" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <div className="bg-orange-100 p-2 rounded-full">
                <UserCheck className="w-5 h-5 text-orange-600" />
              </div>
              ניהול תפקיד
            </DialogTitle>
            <DialogDescription className="text-right">
              בחר האם קיים אצל <b>{roleUser?.full_name}</b> תפקיד המאפשר לקחת
              משמרות. משמרות (החלפות, כיסויים וחלוקה הוגנת) ניתנות לקיחה רק
              כאשר תפקיד RR מוגדר למשתמש — שדה זה נפרד מהרשאות המשתמש ואינו
              משנה אותן.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            {/* RR Option */}
            <div
              onClick={() => setSelectedRole("RR")}
              className={`cursor-pointer rounded-xl border-2 p-4 transition-all relative overflow-hidden group
                ${selectedRole === "RR" ? "border-emerald-400 bg-emerald-50" : "border-gray-200 hover:border-emerald-200 hover:bg-gray-50"}
              `}
            >
              <div className="flex flex-col items-center text-center gap-3">
                <UserCheck className="w-10 h-10 text-emerald-500" />
                <h3 className="font-bold text-gray-800">RR</h3>
                <p className="text-xs text-gray-500 leading-tight">
                  משמרות ניתנות לקיחה — החלפות, כיסויים וחלוקה הוגנת
                </p>
              </div>
              {selectedRole === "RR" && (
                <div className="absolute top-2 right-2 text-emerald-600">
                  <Check className="w-5 h-5" />
                </div>
              )}
            </div>

            {/* None Option */}
            <div
              onClick={() => setSelectedRole("None")}
              className={`cursor-pointer rounded-xl border-2 p-4 transition-all relative overflow-hidden group
                ${selectedRole === "None" ? "border-red-400 bg-red-50" : "border-gray-200 hover:border-red-200 hover:bg-gray-50"}
              `}
            >
              <div className="flex flex-col items-center text-center gap-3">
                <UserX className="w-10 h-10 text-red-500" />
                <h3 className="font-bold text-gray-800">None</h3>
                <p className="text-xs text-gray-500 leading-tight">
                  משמרות אינן ניתנות לקיחה בשום צורה
                </p>
              </div>
              {selectedRole === "None" && (
                <div className="absolute top-2 right-2 text-red-600">
                  <Check className="w-5 h-5" />
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setIsRoleOpen(false)}>
              ביטול
            </Button>
            <Button
              onClick={handleSaveRole}
              disabled={isSubmitting}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {isSubmitting ? "מעדכן..." : "שמור תפקיד"}
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
              עריכת סימן
            </DialogTitle>
            <DialogDescription className="text-right">
              עדכן את הסימן עבור <b>{signUser?.full_name}</b>.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="sign_value" className="text-right">
                קבוצה (סימן)
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
              {isSubmitting ? "שומר..." : "שמור סימן"}
            </Button>
          </DialogFooter>
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
        <DialogContent className="sm:max-w-[480px] text-right" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <div className="bg-blue-100 p-2 rounded-full">
                <UserPlus className="w-5 h-5 text-blue-600" />
              </div>
              הוספת משתמשים לקבוצה {groupPickerSymbol}
            </DialogTitle>
            <DialogDescription className="text-right">
              הסימן של המשתמשים שייבחרו ישתנה ל-<b>{groupPickerSymbol}</b>.
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
              להסיר את קבוצה <b>{groupToDelete}</b>? הסימן יימחק מכל חברי הקבוצה
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
    </AnimatePresence>
  );
}