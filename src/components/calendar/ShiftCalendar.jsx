import React, { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44, setActivityActor, logActivity } from "@/api/base44Client";
import { format, addDays } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useScrollLock } from "@/hooks/useScrollLock";
import {
  normalizeShiftContext,
  computeCoverageSummary,
  buildGiftTemplate,
  buildGeneralTemplate,
  buildHeadToHeadTemplate,
  buildHeadToHeadDeepLink,
  setWhatsappTemplates,
  syncAssignmentOwner,
  createAssignmentForShift,
  resolveOwnerId,
} from "./whatsappTemplates";

// Components
import BackgroundShapes from "./BackgroundShapes";
import CalendarHeader from "./CalendarHeader";
import CalendarGrid from "./CalendarGrid";
import UserNotRegisteredError from "../UserNotRegisteredError"; // מסך חסימה החדש

// Modals
import SwapRequestModal from "./SwapRequestModal";
import AddShiftModal from "./AddShiftModal";
import AcceptSwapModal from "./AcceptSwapModal";
import ShiftActionModal from "./ShiftActionModal";
import EditRoleModal from "./EditRoleModal";
import ShiftDetailsModal from "./ShiftDetailsModal";
import OnboardingModal from "../onboarding/OnboardingModal"; // מסך כניסה החדש
import KPIHeader from "../dashboard/KPIHeader";
import KPIListModal from "../dashboard/KPIListModal";
import AdminSettingsModal from "../admin/AdminSettingsModal";
import SwapSuccessModal from "./SwapSuccessModal";
import HeadToHeadSelectorModal from "./HeadToHeadSelectorModal";
import HeadToHeadApprovalModal from "./HeadToHeadApprovalModal";
import HallOfFameModal from "../dashboard/HallOfFameModal";
import FairnessMatrixModal from "../dashboard/FairnessMatrixModal";
import HelpSupportModal from "../dashboard/HelpSupportModal";
import LoadingSkeleton from "../LoadingSkeleton";
import SwitchFlowBand from "./SwitchFlowBand";
import { isActiveGroupMember } from "@/lib/utils";
import { useViewerMode, isViewerFor } from "@/hooks/useAuthorizedPerson";

// --- Summary of swap flow fixes ---
// 1) AcceptSwapModal replaces legacy CoverSegmentModal across all entry points.
// 2) normalizeShiftContext + resolveSwapType/requestWindow standardize swap payloads for UI and WhatsApp deep links.
// 3) Deep links now hydrate the same shape before rendering modals to avoid race conditions.

// --- Guided-walkthrough demo data ---------------------------------------
// The tour (AppTour in Home.jsx) opens the REAL creation modals so it can
// spotlight their actual buttons — nothing is described only in copy. These
// fictional shifts/coverages feed those modals while `tourDemo` is on, so the
// modals render fully populated without ever touching the backend (their data
// queries are gated on !demoMode) and without showing any real shift. The
// tour's full-screen click-blocker (z 100000) sits above these overlays, so
// none of their action buttons can actually fire — the walkthrough stays
// strictly read-only. Serial ids sit far outside the real id range.
const TOUR_DEMO_ME = {
  serial_id: 900000,
  full_name: "דוד לוי",
  email: "demo.me@razarto.tour",
  permissions: "User",
};

// Build the walkthrough's fictional shifts fresh every time a demo modal opens,
// dated to *today*. A date frozen once at module load goes stale the moment the
// session crosses midnight (or the bundle is reused across days): the demo shift
// then reads as "past" / "not today", which hides the date-gated buttons — "הצע
// מתנה" needs isTodayShift, and ראש בראש / כיסוי need a non-past shift — so the
// step's spotlight target never mounts and the tour skips it with no tooltip.
// Recomputing per open keeps every date-gated button present.
function buildTourDemoShifts() {
  const today = format(new Date(), "yyyy-MM-dd");
  const base = {
    role: "כונן",
    start_date: today,
    end_date: today,
    start_time: "09:00",
    end_time: "17:00",
  };
  return {
    // A plain white shift owned by someone ELSE, starting today →
    // ShiftDetailsModal shows "ראש בראש" + "הצע לקחת את המשמרת במתנה".
    otherShift: {
      ...base,
      id: "tour-other",
      original_user_id: 900001,
      original_user_name: "שמואל כהן",
      user_name: "שמואל כהן",
      department: "א",
      status: "assigned",
    },
    // A plain white shift owned by the demo user → ShiftDetailsModal shows "בקשת
    // החלפה מלאה או חלקית"; also feeds ShiftActionModal and SwapRequestModal.
    ownShift: {
      ...base,
      id: "tour-own",
      original_user_id: TOUR_DEMO_ME.serial_id,
      original_user_name: TOUR_DEMO_ME.full_name,
      user_name: TOUR_DEMO_ME.full_name,
      department: "א",
      status: "assigned",
    },
    // A shift with one already-approved coverage window → feeds AcceptSwapModal
    // so its coverage slider and "אשר כיסוי" button render against real-looking
    // data.
    partialShift: {
      ...base,
      id: "tour-partial",
      original_user_id: 900002,
      original_user_name: "יעל ישראלי",
      user_name: "יעל ישראלי",
      department: "ב",
      status: "partial",
      coverageType: "partial",
      coverages: [
        {
          id: "tour-cov-1",
          covering_user_id: 900004,
          covering_name: "נועה ביטון",
          covering_user_name: "נועה ביטון",
          cover_start_date: today,
          cover_start_time: "09:00",
          cover_end_date: today,
          cover_end_time: "12:00",
          status: "Approved",
        },
      ],
    },
    // A few future full shifts owned by the demo user, offered as the "give in
    // exchange" options inside HeadToHeadSelectorModal's demo list.
    myShifts: [
      {
        ...base,
        id: "tour-my-1",
        start_date: format(addDays(new Date(), 3), "yyyy-MM-dd"),
        end_date: format(addDays(new Date(), 3), "yyyy-MM-dd"),
        original_user_id: TOUR_DEMO_ME.serial_id,
        original_user_name: TOUR_DEMO_ME.full_name,
        user_name: TOUR_DEMO_ME.full_name,
        department: "א",
        status: "Active",
      },
      {
        ...base,
        id: "tour-my-2",
        start_date: format(addDays(new Date(), 8), "yyyy-MM-dd"),
        end_date: format(addDays(new Date(), 8), "yyyy-MM-dd"),
        original_user_id: TOUR_DEMO_ME.serial_id,
        original_user_name: TOUR_DEMO_ME.full_name,
        user_name: TOUR_DEMO_ME.full_name,
        department: "א",
        status: "Active",
      },
    ],
  };
}

export default function ShiftCalendar() {
  const queryClient = useQueryClient();

  // --- STATES ---
  const [currentDate, setCurrentDate] = useState(new Date());
  const [clickedDate, setClickedDate] = useState(null); // Fix: Store specific clicked date
  const [viewMode, setViewMode] = useState("month");

  // Modal Visibilities
  const [selectedShift, setSelectedShift] = useState(null);
  const [showSwapRequestModal, setShowSwapRequestModal] = useState(false);
  const [swapRequestInitialType, setSwapRequestInitialType] = useState("full");
  const [showAddShiftModal, setShowAddShiftModal] = useState(false);
  const [showAcceptSwapModal, setShowAcceptSwapModal] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [showEditRoleModal, setShowEditRoleModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showAdminSettings, setShowAdminSettings] = useState(false);
  const [showHallOfFame, setShowHallOfFame] = useState(false);
  const [showFairnessMatrix, setShowFairnessMatrix] = useState(false);
  // Manager-only: { date, items } of consideration requests for a clicked cell.
  const [considerationDetail, setConsiderationDetail] = useState(null);
  const [showHelpSupport, setShowHelpSupport] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [deepLinkShiftId, setDeepLinkShiftId] = useState(null);

  // KPI & Success Modals
  const [showKPIListModal, setShowKPIListModal] = useState(false);
  const [kpiListType, setKpiListType] = useState("swap_requests");
  // Which tab KPIListModal should start on, and a counter bumped on every
  // open so its `key` changes even when re-opening the same `type` with a
  // different tab (e.g. from a notification popup) — otherwise React would
  // keep the old mounted instance and its local tab state.
  const [kpiInitialTab, setKpiInitialTab] = useState("all");
  const [kpiOpenSeq, setKpiOpenSeq] = useState(0);
  // When opening KPIListModal to point at one specific request (e.g. from the
  // "אני רוצה לעזור!" button on a full-coverage request), the id to scroll to
  // and briefly highlight inside the list.
  const [kpiFocusRequestId, setKpiFocusRequestId] = useState(null);
  // Set only by the guided walkthrough: when true, KPIListModal renders a set of
  // demo requests/shifts instead of real account data so the tour can show a
  // populated list in every tab. Read-only, never persisted.
  const [tourDemo, setTourDemo] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastUpdatedShift, setLastUpdatedShift] = useState(null);
  // Whether the just-created request was a whole-shift (now General) swap vs a
  // Partial one — drives which ready-made WhatsApp template the success modal
  // shares (general broadcast vs partial-coverage wording).
  const [lastSwapWasGeneral, setLastSwapWasGeneral] = useState(false);

  // Head-to-Head States
  const [showHeadToHeadSelector, setShowHeadToHeadSelector] = useState(false);
  // Tour only: when true, the demo ShiftDetailsModal auto-opens its gift
  // confirmation dialog so the "מתנה" step can spotlight the confirm button.
  const [tourGiftConfirm, setTourGiftConfirm] = useState(false);
  const [showHeadToHeadApproval, setShowHeadToHeadApproval] = useState(false);
  const [h2hTargetId, setH2hTargetId] = useState(null);
  const [h2hOfferId, setH2hOfferId] = useState(null);

  // Switch Request Flow State (multi-shift swap)
  // null = inactive; otherwise { step: 'own' | 'target', ownShiftIds: string[], targetShiftIds: string[] }
  const [switchFlow, setSwitchFlow] = useState(null);
  // A Head2Head request can only target shifts belonging to one other person
  // at a time (see switchRequestMutation); this surfaces a red warning when
  // the user tries to pick a target shift belonging to someone else.
  const [switchFlowWarning, setSwitchFlowWarning] = useState(null);
  const switchFlowWarningTimeoutRef = useRef(null);

  // Shown at the bottom of the page for 3s whenever a user who is not the
  // active member of their group (per the ShiftGroup active-member rule —
  // separate from permissions) tries to take a shift in any way (offer to
  // cover, accept a general/head-to-head request, propose/approve a
  // head-to-head swap, or select a target shift in the multi-shift switch
  // flow). Giving away one's OWN shifts is never blocked by this — only
  // acquiring someone else's is.
  const [roleError, setRoleError] = useState(null);
  const roleErrorTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (switchFlowWarningTimeoutRef.current)
        clearTimeout(switchFlowWarningTimeoutRef.current);
      if (roleErrorTimeoutRef.current)
        clearTimeout(roleErrorTimeoutRef.current);
    };
  }, []);

  const showRoleError = () => {
    if (roleErrorTimeoutRef.current) clearTimeout(roleErrorTimeoutRef.current);
    // A read-only viewer gets an accurate message rather than the active-member
    // one — they DO have a role, the app is just in view-only mode for them.
    setRoleError(
      isViewer ? "מצב צפייה בלבד — לא ניתן לבצע שינויים" : "אין לך הרשאה לקחת משמרות",
    );
    roleErrorTimeoutRef.current = setTimeout(() => setRoleError(null), 3000);
  };

  // Listens for the notification sidebar's action-button clicks
  // (messageStore.js's dispatchAction) so a popup can open KPIListModal
  // directly on the tab relevant to it. `detail.target` is "kpi:<type>" or
  // "kpi:<type>:<tab>" — see src/components/sidebar/notificationEvents.js.
  useEffect(() => {
    const handleSidebarAction = (e) => {
      const target = e.detail?.target;
      if (typeof target !== "string" || !target.startsWith("kpi:")) return;
      const [, type, tab] = target.split(":");
      if (!type) return;
      setKpiListType(type);
      setKpiInitialTab(tab || "all");
      setKpiOpenSeq((n) => n + 1);
      setShowKPIListModal(true);
    };
    window.addEventListener("razarto:sidebar-action", handleSidebarAction);
    return () =>
      window.removeEventListener("razarto:sidebar-action", handleSidebarAction);
  }, []);

  // Lets the guided walkthrough (AppTour in Home.jsx) open the real menus and
  // creation modals so it can spotlight their actual buttons. This only toggles
  // UI state and feeds demo shifts (TOUR_DEMO_*) when `demo` is set; it never
  // creates/updates/deletes any entity, the demo modals' data queries are gated
  // on !demoMode, and the tour renders a full-screen click-blocker above every
  // overlay so no action button (request/accept/gift/head-to-head/confirm) can
  // fire during the tour. `detail.open` selects the surface to show:
  //   "kpi"           → the KPI request list on a given tab
  //   "switchflow"    → the multi-shift switch band
  //   "details-other" → ShiftDetailsModal on someone else's shift (h2h + gift);
  //                      pass giftConfirm:true to also pop the gift-confirm step
  //   "details-own"   → ShiftDetailsModal on the viewer's own shift (request)
  //   "action"        → ShiftActionModal (admin quick actions)
  //   "request"       → SwapRequestModal; pass requestType:"partial" for the
  //                      partial (windowed) form, else the full form
  //   "h2h-select"    → HeadToHeadSelectorModal (pick one of my shifts to offer)
  //   "accept"        → AcceptSwapModal (join a partial gap)
  //   null            → close everything.
  useEffect(() => {
    const handleTourControl = (e) => {
      const { open, kpiType, kpiTab, demo, requestType, giftConfirm } =
        e.detail || {};
      // Reset every tour-driven surface first so each step is a clean,
      // idempotent request for exactly the state it wants.
      setShowKPIListModal(false);
      setShowDetailsModal(false);
      setShowActionModal(false);
      setShowSwapRequestModal(false);
      setShowAcceptSwapModal(false);
      setShowHeadToHeadSelector(false);
      setTourGiftConfirm(false);
      setSwitchFlow(null);
      setTourDemo(!!demo);
      // Rebuilt each event so the demo shifts are always dated to today (see
      // buildTourDemoShifts) — keeps date-gated buttons like "הצע מתנה" present.
      const demoShifts = buildTourDemoShifts();
      switch (open) {
        case "kpi":
          setKpiListType(kpiType || "swap_requests");
          setKpiInitialTab(kpiTab || "all");
          setKpiOpenSeq((n) => n + 1);
          setShowKPIListModal(true);
          break;
        case "switchflow":
          setSwitchFlow({ step: "own", ownShiftIds: [], targetShiftIds: [] });
          break;
        case "details-other":
          setSelectedShift(demoShifts.otherShift);
          // giftConfirm → also pop the gift confirmation dialog on top of the
          // details modal (the "מתנה" send step).
          setTourGiftConfirm(!!giftConfirm);
          setShowDetailsModal(true);
          break;
        case "details-own":
          setSelectedShift(demoShifts.ownShift);
          setShowDetailsModal(true);
          break;
        case "action":
          setSelectedShift(demoShifts.ownShift);
          setShowActionModal(true);
          break;
        case "request":
          setSelectedShift(demoShifts.ownShift);
          setSwapRequestInitialType(
            requestType === "partial" ? "partial" : "full",
          );
          setShowSwapRequestModal(true);
          break;
        case "h2h-select":
          // Head-to-head selector, opened against someone else's shift, with a
          // demo list of "my shifts" to offer in exchange.
          setSelectedShift(demoShifts.otherShift);
          setShowHeadToHeadSelector(true);
          break;
        case "accept":
          setSelectedShift(demoShifts.partialShift);
          setShowAcceptSwapModal(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener("razarto:tour-control", handleTourControl);
    return () =>
      window.removeEventListener("razarto:tour-control", handleTourControl);
  }, []);

  // Lock background scrolling while any modal/menu is open, so only the
  // open overlay scrolls — not the calendar behind it.
  const anyModalOpen =
    showSwapRequestModal ||
    showAddShiftModal ||
    showAcceptSwapModal ||
    showActionModal ||
    showEditRoleModal ||
    showDetailsModal ||
    showAdminSettings ||
    showHallOfFame ||
    showFairnessMatrix ||
    showHelpSupport ||
    showLogoutConfirm ||
    showSuccessModal ||
    showHeadToHeadSelector ||
    showHeadToHeadApproval ||
    showKPIListModal;
  useScrollLock(anyModalOpen);

  // --- DEBUG LOGS (Internal Only, Hidden from UI) ---
  const appendSwapLog = (message, data) => {
    const timestamp = new Date().toLocaleTimeString("he-IL", { hour12: false });
    const payloadText = data ? ` | נתונים: ${JSON.stringify(data)}` : "";
    console.debug(`[SWAP-LOG ${timestamp}] ${message}${payloadText}`);
  };

  // --- AUTH & USER IDENTIFICATION LOGIC ---

  // 1. Get Current Base44 User
  const { data: currentUser, isLoading: isUserLoading } = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const user = await base44.auth.me();
      console.log("👤 [DEBUG] Fetched Current User:", user);
      return user;
    },
  });

  // *** FIX: Handle Case Sensitivity (Email vs email) ***
  const userEmail = currentUser?.email || currentUser?.Email;

  // 2. Check Authorization against AuthorizedPerson table
  const {
    data: authorizedPerson,
    isLoading: isAuthCheckLoading,
    refetch: refreshAuthCheck,
  } = useQuery({
    queryKey: ["check-authorization", userEmail],
    queryFn: async () => {
      if (!userEmail) {
        console.log("❌ [DEBUG] No email found to check authorization.");
        return null;
      }

      console.log("🔍 [DEBUG] Checking authorization for:", userEmail);
      // Fetch all authorized people and search case-insensitive on client-side
      const allPeople = await base44.entities.AuthorizedPerson.list();

      // Case-insensitive search
      const normalizedUserEmail = userEmail.toLowerCase();
      console.log("🔍 [DEBUG] normalizedUserEmail:", normalizedUserEmail);
      const match = allPeople.find(
        (person) =>
          person.email && person.email.toLowerCase() === normalizedUserEmail,
      );

      console.log("🔍 [DEBUG] match:", match);

      // debug is gated on the record we just found, since `authorizedPerson`
      // (and any isAdmin derived from it) doesn't exist until this query resolves
      if (match?.permissions === "Admin") {
        console.log("📄 [DEBUG] All AuthorizedPerson records:", allPeople);
        console.log("✅ [DEBUG] Final Authorization Result:", match || null);
      }

      return match || null;
    },
    enabled: !!userEmail,
  });

  // Group "active member" records (ShiftGroup): one row per group symbol,
  // holding that group's active member (serial_id = their serial_id) and an active
  // flag. Only the active member of a group interacts with shifts — the same
  // signal shift distribution uses to pick who gets assigned. Any authorized
  // user may read these (see ShiftGroup RLS).
  const { data: shiftGroups = [] } = useQuery({
    queryKey: ["shift-groups"],
    queryFn: () => base44.entities.ShiftGroup.list(),
    enabled: !!authorizedPerson,
  });

  // Admin "RR ⇒ viewer" overlay: while the switch is on, an RR user is treated
  // as a read-only viewer (sees everything an RR user sees, but may not create
  // or change anything). Their stored permission is untouched — this is runtime
  // only, off the moment the admin flips the switch back.
  const viewerModeOn = useViewerMode();
  const isViewer = isViewerFor(authorizedPerson?.permissions, viewerModeOn);

  // A user may take/interact with shifts (offer to cover, accept a
  // general/head-to-head request, propose/approve a head-to-head swap, open a
  // swap request, or pick target shifts in the switch flow) only while they are
  // the active member of THEIR OWN group. Delegated to the shared
  // isActiveGroupMember rule (src/lib/utils.js) so this gate can't drift from
  // the admin star, the assignment dropdowns, or fair distribution. A read-only
  // viewer never takes shifts, so the overlay short-circuits this too — every
  // acquire handler already guards on canTakeShifts.
  const canTakeShifts = useMemo(
    () => !isViewer && isActiveGroupMember(authorizedPerson, shiftGroups),
    [authorizedPerson, shiftGroups, isViewer],
  );

  // --- DEBUG: only logs for Admin, silent for everyone else ---
  const isAdminUser = authorizedPerson?.permissions === "Admin";
  const debugLog = (...args) => {
    if (isAdminUser) {
      console.log(...args);
    }
  };

  // --- MUTATION: Link User (Onboarding Completion) ---
  const linkUserMutation = useMutation({
    mutationFn: async () => {
      if (!authorizedPerson || !currentUser) return;
      // Client-side onboarding: the user's email was already verified against
      // the AuthorizedPerson whitelist (the onboarding screen only renders
      // when `authorizedPerson` resolved by email match), so here we flip
      // is_authorized on the platform User — the flag every entity RLS read
      // rule checks — and sync serial_id in the same call. (Backend functions
      // require a Builder+ plan, so this runs from the client; the whitelist
      // gate in AuthorizedRoute is the first layer of access control.)
      return base44.auth.updateMe({
        is_authorized: true,
        serial_id: authorizedPerson.serial_id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("החיבור בוצע בהצלחה! ברוכים הבאים.");
    },
    onError: (err) => {
      debugLog("❌ [DEBUG] Link Error:", err);
      toast.error("שגיאה בחיבור המשתמש.");
    },
  });

  // --- SYNC serial_id to the platform User entity ---
  // onboarding sets is_authorized + serial_id together, but as a safety net
  // this reconciles serial_id for any authorized user whose User entity
  // doesn't yet match their AuthorizedPerson.serial_id.
  useEffect(() => {
    if (!currentUser?.is_authorized || !authorizedPerson) return;
    if (authorizedPerson.serial_id == null) return;
    if (Number(currentUser.serial_id) === Number(authorizedPerson.serial_id))
      return;
    base44.auth
      .updateMe({ serial_id: authorizedPerson.serial_id })
      .then(() => queryClient.invalidateQueries(["current-user"]))
      .catch((e) =>
        debugLog("⚠️ [ShiftCalendar] Failed to sync serial_id:", e),
      );
  }, [authorizedPerson, currentUser]);

  // Register the acting user for activity logging, so every data mutation the
  // app records (see logActivity in base44Client) is attributed to this person
  // without threading the actor through each call site.
  useEffect(() => {
    setActivityActor(authorizedPerson || null);
  }, [authorizedPerson]);

  // Log a single "login" entry the first time the acting user is resolved this
  // session (guarded by a ref so the actor-sync re-renders don't re-log it).
  const loginLoggedRef = useRef(false);
  useEffect(() => {
    if (!authorizedPerson || loginLoggedRef.current) return;
    loginLoggedRef.current = true;
    logActivity({
      action: "כניסה למערכת",
      type: "כניסות משתמשים",
      entity: "User",
      actor: authorizedPerson,
    });
  }, [authorizedPerson]);

  // Load admin-edited WhatsApp message templates once (setting_key
  // "whatsapp_templates" on AppSettings) and register them app-wide, so every
  // ready-made WhatsApp share (here and in child modals) uses the custom wording
  // with a fallback to the built-in defaults. See setWhatsappTemplates.
  const { data: appSettingsList = [] } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => base44.entities.AppSettings.list(),
    enabled: !!authorizedPerson,
  });
  useEffect(() => {
    const row = appSettingsList.find(
      (s) => s.setting_key === "whatsapp_templates",
    );
    if (!row?.value) {
      setWhatsappTemplates({});
      return;
    }
    try {
      setWhatsappTemplates(JSON.parse(row.value));
    } catch {
      setWhatsappTemplates({});
    }
  }, [appSettingsList]);

  // --- MAIN DATA QUERIES (Shifts, Users, Requests, Coverages) ---
  const { data: shifts = [], isLoading: isShiftsLoading } = useQuery({
    queryKey: ["shifts"],
    queryFn: () => base44.entities.Shift.list(),
    enabled: !!authorizedPerson,
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ["all-users"],
    queryFn: () => base44.entities.AuthorizedPerson.list(),
    enabled: !!authorizedPerson,
  });

  const { data: swapRequests = [] } = useQuery({
    queryKey: ["swap-requests"],
    queryFn: () => base44.entities.SwapRequest.list(),
    enabled: !!authorizedPerson,
  });

  const { data: coverages = [] } = useQuery({
    queryKey: ["coverages"],
    queryFn: () => base44.entities.ShiftCoverage.list(),
    enabled: !!authorizedPerson,
  });

  // Consideration requests power the manager-only calendar highlight: dates a
  // user asked to be protected on. Only fetched for managers/admins (the only
  // ones who see the badge and its detail). `isAdmin` proper is derived far
  // below, so recompute the manager/admin check locally here.
  const isManagerOrAdmin =
    authorizedPerson?.permissions === "Manager" ||
    authorizedPerson?.permissions === "Admin";
  const { data: considerationRequests = [] } = useQuery({
    queryKey: ["consideration-requests"],
    queryFn: () => base44.entities.ConsiderationRequest.list(),
    enabled: !!authorizedPerson && isManagerOrAdmin,
  });

  // date 'yyyy-MM-dd' -> [{ name, status, serial_id }] for non-rejected
  // requests, so a marked cell can show who asked and whether it was accepted.
  const considerationsByDate = useMemo(() => {
    const map = new Map();
    considerationRequests.forEach((r) => {
      if (!r.date || r.status === "rejected") return;
      if (!map.has(r.date)) map.set(r.date, []);
      map.get(r.date).push({
        name: r.user_name || "לא ידוע",
        status: r.status,
        serial_id: r.serial_id,
      });
    });
    return map;
  }, [considerationRequests]);

  // --- LAZY CLEANUP: remove SwapRequests whose date has already passed, and ---
  // reconcile shifts left stuck in a swap-related status with no live request
  // backing them (e.g. after the SwapRequest table was cleared out-of-band).
  // Closed/Cancelled/Completed requests are left alone as history.
  useEffect(() => {
    if (!authorizedPerson || shifts.length === 0) return;

    const today = format(new Date(), "yyyy-MM-dd");
    const activeStatuses = ["Open", "Partially_Covered"];

    const staleRequests = swapRequests.filter(
      (sr) =>
        activeStatuses.includes(sr.status) &&
        (sr.req_end_date || sr.req_start_date) < today,
    );

    // Orphaned coverages: a "cover" ShiftCoverage whose backing SwapRequest is
    // gone (e.g. force-deleted out-of-band). Normal cancels now DELETE the cover
    // row directly, so orphans only accrue from out-of-band request deletion —
    // but a dangling cover still makes a shift render "covered" (via
    // isFullyCovered), so self-heal by deleting any "cover" row whose shift is
    // no longer referenced by a live/closed request. Base "assignment" rows
    // (ownership, no parent request) are never touched.
    //   Guard with swapRequests.length > 0 so a transient empty fetch can't
    // mass-delete every cover.
    const shiftIdsWithBackingRequest = new Set(
      swapRequests
        .filter((sr) =>
          ["Open", "Partially_Covered", "Closed"].includes(sr.status),
        )
        .flatMap((sr) => sr.shift_ids || []),
    );
    const orphanedCoverages =
      swapRequests.length > 0
        ? coverages.filter(
            (c) =>
              c.type === "cover" && !shiftIdsWithBackingRequest.has(c.shift_id),
          )
        : [];

    if (staleRequests.length === 0 && orphanedCoverages.length === 0) return;

    Promise.all([
      ...staleRequests.map((sr) => base44.entities.SwapRequest.delete(sr.id)),
      ...orphanedCoverages.map((c) =>
        base44.entities.ShiftCoverage.delete(c.id),
      ),
    ])
      .then(() => {
        debugLog(
          "🧹 [ShiftCalendar] Cleaned up expired swap requests & orphaned coverages:",
          {
            requestIds: staleRequests.map((sr) => sr.id),
            coverageIds: orphanedCoverages.map((c) => c.id),
          },
        );
        queryClient.invalidateQueries(["swap-requests"]);
        queryClient.invalidateQueries(["shifts"]);
        queryClient.invalidateQueries(["coverages"]);
      })
      .catch((error) => {
        debugLog(
          "❌ [ShiftCalendar] Failed to clean up expired swap requests:",
          error,
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorizedPerson, shifts, swapRequests, coverages]);

  // Enrich shifts with user data and swap status (shared across UI & deep links)
  const enrichedShifts = shifts.map((shift) =>
    normalizeShiftContext(shift, {
      allUsers,
      swapRequests,
      coverages,
      currentUser: authorizedPerson,
    }),
  );

  // Fixed: Handle deep link via query params to open shift details or head-to-head approval
  useEffect(() => {
    if (typeof window === "undefined" || !authorizedPerson) return;

    const params = new URLSearchParams(window.location.search);
    const openShiftId = params.get("openShiftId");
    const headToHeadTarget = params.get("headToHeadTarget");
    const headToHeadOffer = params.get("headToHeadOffer");
    // Gift links (and any KPI deep link) open a KPI list on a specific tab,
    // optionally focused on one request — "<type>:<tab>" + focusRequestId.
    const openKpi = params.get("openKpi");
    const focusRequestId = params.get("focusRequestId");

    if (headToHeadTarget && headToHeadOffer) {
      setDeepLinkShiftId(null);
      setH2hTargetId(headToHeadTarget);
      setH2hOfferId(headToHeadOffer);
      setShowDetailsModal(false);
      setShowHeadToHeadSelector(false);
      setShowHeadToHeadApproval(true);
    } else if (openKpi) {
      const [kpiType, kpiTab] = openKpi.split(":");
      setDeepLinkShiftId(null);
      setKpiListType(kpiType || "swap_requests");
      setKpiInitialTab(kpiTab || "all");
      setKpiFocusRequestId(focusRequestId || null);
      setKpiOpenSeq((n) => n + 1);
      setShowKPIListModal(true);
    } else if (openShiftId) {
      setDeepLinkShiftId(openShiftId);
    } else {
      return;
    }

    window.history.replaceState(
      {},
      document.title,
      `${window.location.pathname}${window.location.hash}`,
    );
  }, [authorizedPerson]);

  useEffect(() => {
    if (!deepLinkShiftId || !authorizedPerson) return;

    const hydratedFromList = enrichedShifts.find(
      (s) => String(s?.id) === String(deepLinkShiftId),
    );
    if (hydratedFromList) {
      setSelectedShift(hydratedFromList);
      setShowDetailsModal(true);
      return;
    }

    const fetchAndHydrate = async () => {
      try {
        const shiftData = await base44.entities.Shift.get(deepLinkShiftId);
        if (!shiftData) {
          toast.error("המשמרת לא נמצאה");
          return;
        }

        const hydratedShift = normalizeShiftContext(shiftData, {
          allUsers,
          swapRequests,
          coverages,
          currentUser: authorizedPerson,
        });

        setSelectedShift(hydratedShift);
        setShowDetailsModal(true);
      } catch (error) {
        console.error(
          "❌ [ShiftCalendar] Failed to open shift from deep link",
          error,
        );
        toast.error("המשמרת לא נמצאה");
      }
    };

    fetchAndHydrate();
  }, [
    allUsers,
    authorizedPerson,
    coverages,
    deepLinkShiftId,
    enrichedShifts,
    swapRequests,
  ]);

  // --- MUTATIONS (Shift Operations) ---

  const requestSwapMutation = useMutation({
    mutationFn: async ({ shiftId, type, dates }) => {
      const shift = shifts.find((s) => s.id === shiftId);
      if (!shift) throw new Error("Shift not found");

      const isFull = type === "full";
      const req_start_date = isFull
        ? shift.start_date
        : dates.startDate || shift.start_date;
      const req_end_date = isFull
        ? shift.end_date || shift.start_date
        : dates.endDate || shift.end_date || dates.startDate;
      const req_start_time = isFull
        ? shift.start_time || "09:00"
        : dates.startTime || shift.start_time || "09:00";
      const req_end_time = isFull
        ? shift.end_time || req_start_time
        : dates.endTime || shift.end_time || req_start_time;

      const payload = {
        shift_ids: [shiftId],
        requesting_user_id: authorizedPerson.serial_id,
        // A whole-shift swap is an open, permanent-handoff request to the whole
        // team — i.e. a General request. (The former dedicated "Full" type was
        // redundant with General and has been removed.) A partial swap keeps the
        // windowed "Partial" coverage semantics.
        request_type: isFull ? "General" : "Partial",
        req_start_date,
        req_end_date,
        req_start_time,
        req_end_time,
        status: "Open",
      };

      appendSwapLog("📨 שולח בקשה למסד", payload);
      debugLog(
        "📨 [ShiftCalendar] Creating SwapRequest with payload:",
        payload,
      );

      await base44.entities.SwapRequest.create(payload);

      // The shift's "requested" state is now derived from the open SwapRequest
      // above (Phase 4) — no Shift.status to write. Return the shift for the
      // success modal.
      appendSwapLog("✅ הבקשה נשמרה");
      return shifts.find((s) => s.id === shiftId) || { id: shiftId };
    },
    onMutate: (variables) => {
      appendSwapLog("🚀 התחלת שליחה", variables);
    },
    onSuccess: (data, variables) => {
      appendSwapLog("✅ הבקשה נשמרה והמשמרת עודכנה");
      logActivity({
        action:
          variables?.type === "full"
            ? "יצירת בקשת החלפה כללית"
            : "יצירת בקשת החלפה חלקית",
        type: "בקשות החלפה",
        entity: "SwapRequest",
        entityId: variables?.shiftId,
        details: {
          request_type: variables?.type === "full" ? "כללית" : "חלקית",
          requester: authorizedPerson?.full_name,
          shifts: [
            {
              date: data?.start_date,
              start_time:
                variables?.dates?.startTime || data?.start_time,
              end_time: variables?.dates?.endTime || data?.end_time,
            },
          ],
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      toast.success("בקשת ההחלפה נשלחה בהצלחה!");
      setLastUpdatedShift(data);
      setLastSwapWasGeneral(variables?.type === "full");
      setShowSwapRequestModal(false);
      setShowActionModal(false);
      setShowSuccessModal(true);
    },
    onError: (error) => {
      appendSwapLog("❌ שגיאה בשליחת הבקשה", {
        error: error?.message || String(error),
      });
      debugLog("❌ [ShiftCalendar] Swap request failed:", error);
      toast.error("שליחת בקשת ההחלפה נכשלה. נסו שוב.");
    },
  });

  const switchRequestMutation = useMutation({
    mutationFn: async ({ ownShiftIds, targetShiftIds }) => {
      const ownShifts = shifts.filter((s) => ownShiftIds.includes(s.id));
      const req_start_date = ownShifts.map((s) => s.start_date).sort()[0];
      const req_end_date = ownShifts
        .map((s) => s.end_date || s.start_date)
        .sort()
        .slice(-1)[0];
      const req_start_time = ownShifts[0]?.start_time || "09:00";
      const req_end_time = ownShifts[0]?.end_time || req_start_time;

      // Group target shifts by their owner: multiple target shifts belonging
      // to the SAME other person become one request (offered_shift_ids holds
      // all of them). Only targets belonging to different people produce
      // separate requests.
      const targetShifts = shifts.filter((s) => targetShiftIds.includes(s.id));
      const targetIdsByOwner = new Map();
      targetShifts.forEach((s) => {
        // `shifts` is the raw base44 list, so ownership must be resolved from the
        // assignment coverage row (Shift.original_user_id was removed in Phase 4).
        const ownerId = resolveOwnerId(s, coverages);
        if (!targetIdsByOwner.has(ownerId)) targetIdsByOwner.set(ownerId, []);
        targetIdsByOwner.get(ownerId).push(s.id);
      });

      await Promise.all(
        Array.from(targetIdsByOwner.values()).map((offeredIdsForOwner) =>
          base44.entities.SwapRequest.create({
            shift_ids: ownShiftIds,
            offered_shift_ids: offeredIdsForOwner,
            requesting_user_id: authorizedPerson.serial_id,
            request_type: "Head2Head",
            req_start_date,
            req_end_date,
            req_start_time,
            req_end_time,
            status: "Open",
          }),
        ),
      );
      // Shift "requested" state is derived from these open requests (Phase 4).
    },
    onSuccess: (_data, { ownShiftIds, targetShiftIds }) => {
      const ownShiftsSnap = shifts.filter((s) => ownShiftIds.includes(s.id));
      const targetShiftsSnap = shifts.filter((s) =>
        targetShiftIds.includes(s.id),
      );
      const targetOwnerId = targetShiftsSnap[0]
        ? resolveOwnerId(targetShiftsSnap[0], coverages)
        : null;
      const toOwner = allUsers.find(
        (u) => Number(u.serial_id) === Number(targetOwnerId),
      );
      const shiftSnap = (s) => ({
        date: s.start_date,
        start_time: s.start_time,
        end_time: s.end_time,
      });
      logActivity({
        action: "יצירת בקשת החלפה ראש-בראש",
        type: "בקשות החלפה",
        entity: "SwapRequest",
        details: {
          request_type: "ראש-בראש",
          requester: authorizedPerson?.full_name,
          to: toOwner?.full_name,
          offered_shifts: ownShiftsSnap.map(shiftSnap),
          requested_shifts: targetShiftsSnap.map(shiftSnap),
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);

      // Ready-made WhatsApp message for the head-to-head offer (optional action
      // on the success toast). The switch flow restricts targets to a single
      // owner, so one message covers the request. Wording is admin-editable via
      // the "הודעות וואטסאפ" tab (setting_key whatsapp_templates).
      const targetShift = shifts.find((s) => s.id === targetShiftIds[0]);
      const ownShift = shifts.find((s) => s.id === ownShiftIds[0]);
      // Full lists for both sides so the message spells out every bundled shift
      // (they can be several non-contiguous shifts, not one span).
      const ownShifts = shifts.filter((s) => ownShiftIds.includes(s.id));
      const targetShiftsList = shifts.filter((s) =>
        targetShiftIds.includes(s.id),
      );
      const targetOwner = allUsers.find(
        (u) =>
          Number(u.serial_id) ===
          Number(resolveOwnerId(targetShift, coverages)),
      );
      const fmt = (d) => (d ? format(new Date(d), "dd/MM") : "");
      toast.success("בקשות ההחלפה נשלחו בהצלחה!", {
        duration: 10000,
        action: {
          label: "שליחה בוואטסאפ",
          onClick: () => {
            const message = buildHeadToHeadTemplate({
              targetUserName: targetOwner?.full_name,
              targetShiftOwner: targetOwner?.full_name,
              targetShiftDate: fmt(targetShift?.start_date),
              myShiftOwner: authorizedPerson.full_name,
              myShiftDate: fmt(ownShift?.start_date),
              myShifts: ownShifts,
              targetShifts: targetShiftsList,
              uniqueApprovalUrl: buildHeadToHeadDeepLink(
                targetShiftIds[0],
                ownShiftIds[0],
              ),
            });
            window.open(
              `https://wa.me/?text=${encodeURIComponent(message)}`,
              "_blank",
            );
          },
        },
      });

      if (switchFlowWarningTimeoutRef.current)
        clearTimeout(switchFlowWarningTimeoutRef.current);
      setSwitchFlowWarning(null);
      setSwitchFlow(null);
    },
    onError: (error) => {
      debugLog("❌ [ShiftCalendar] Switch request failed:", error);
      toast.error("שליחת בקשות ההחלפה נכשלה. נסו שוב.");
    },
  });

  // "Skip" path of the switch flow: send the selected own shifts as an open,
  // general swap request (request_type 'General', empty offered_shift_ids) so
  // ANY other user can either take them outright ("accept without terms") or
  // reply with a head-to-head counter-offer by picking their own shifts.
  const generalSwitchRequestMutation = useMutation({
    mutationFn: async ({ ownShiftIds }) => {
      const ownShifts = shifts.filter((s) => ownShiftIds.includes(s.id));
      if (ownShifts.length === 0) throw new Error("No shifts selected");
      const req_start_date = ownShifts.map((s) => s.start_date).sort()[0];
      const req_end_date = ownShifts
        .map((s) => s.end_date || s.start_date)
        .sort()
        .slice(-1)[0];
      const req_start_time = ownShifts[0]?.start_time || "09:00";
      const req_end_time = ownShifts[0]?.end_time || req_start_time;

      await base44.entities.SwapRequest.create({
        shift_ids: ownShiftIds,
        offered_shift_ids: [],
        requesting_user_id: authorizedPerson.serial_id,
        request_type: "General",
        req_start_date,
        req_end_date,
        req_start_time,
        req_end_time,
        status: "Open",
      });
      // Shift "requested" state is derived from this open request (Phase 4).
    },
    onSuccess: (_data, { ownShiftIds }) => {
      logActivity({
        action: "יצירת בקשת החלפה כללית",
        type: "בקשות החלפה",
        entity: "SwapRequest",
        details: {
          request_type: "כללית",
          requester: authorizedPerson?.full_name,
          shifts: shifts
            .filter((s) => ownShiftIds.includes(s.id))
            .map((s) => ({
              date: s.start_date,
              start_time: s.start_time,
              end_time: s.end_time,
            })),
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);

      // Ready-made WhatsApp broadcast for the general request (optional action
      // on the success toast) — its message is admin-editable via the
      // "הודעות וואטסאפ" tab (setting_key whatsapp_templates).
      const ownShifts = shifts.filter((s) => ownShiftIds.includes(s.id));
      const startDate = ownShifts.map((s) => s.start_date).sort()[0];
      const endDate = ownShifts
        .map((s) => s.end_date || s.start_date)
        .sort()
        .slice(-1)[0];
      toast.success("בקשת ההחלפה הכללית נשלחה!", {
        duration: 10000,
        action: {
          label: "שליחה בוואטסאפ",
          onClick: () => {
            const message = buildGeneralTemplate({
              originalOwnerName: authorizedPerson.full_name,
              startDate,
              startTime: ownShifts[0]?.start_time,
              endDate,
              endTime: ownShifts[0]?.end_time,
              // Every bundled shift, listed per line (they may be several
              // non-contiguous shifts, not one continuous span).
              shifts: ownShifts,
              shiftId: ownShiftIds[0],
            });
            window.open(
              `https://wa.me/?text=${encodeURIComponent(message)}`,
              "_blank",
            );
          },
        },
      });

      if (switchFlowWarningTimeoutRef.current)
        clearTimeout(switchFlowWarningTimeoutRef.current);
      setSwitchFlowWarning(null);
      setSwitchFlow(null);
    },
    onError: (error) => {
      debugLog("❌ [ShiftCalendar] General switch request failed:", error);
      toast.error("שליחת בקשת ההחלפה נכשלה. נסו שוב.");
    },
  });

  // Accepting a general/open request "without terms": the accepting user
  // simply takes every shift the requester offered (nothing offered back),
  // the request closes, and any other open request referencing those shifts
  // (e.g. a pending counter-offer) is cancelled as no longer valid.
  const acceptGeneralRequestMutation = useMutation({
    mutationFn: async (request) => {
      const theirShiftIds = request.shift_ids || [];
      if (theirShiftIds.length === 0) return;

      // Ownership lives in the base "assignment" coverage row (Phase 4) — point
      // each taken shift's assignment at the accepting user.
      await Promise.all(
        theirShiftIds.map((id) =>
          syncAssignmentOwner(id, authorizedPerson.serial_id, coverages),
        ),
      );

      await base44.entities.SwapRequest.update(request.id, {
        status: "Closed",
      });

      const staleSiblings = swapRequests.filter(
        (sr) =>
          sr.id !== request.id &&
          ["Open", "Partially_Covered"].includes(sr.status) &&
          (sr.shift_ids?.some((id) => theirShiftIds.includes(id)) ||
            sr.offered_shift_ids?.some((id) => theirShiftIds.includes(id))),
      );
      await Promise.all(
        staleSiblings.map((sr) =>
          base44.entities.SwapRequest.update(sr.id, { status: "Cancelled" }),
        ),
      );
    },
    onSuccess: (_data, request) => {
      logActivity({
        action: "לקיחת בקשת החלפה כללית",
        type: "בקשות החלפה",
        entity: "SwapRequest",
        entityId: request?.id,
        details: {
          request_type: "לקיחת בקשה כללית",
          taker: authorizedPerson?.full_name,
          from: allUsers.find(
            (u) =>
              Number(u.serial_id) === Number(request?.requesting_user_id),
          )?.full_name,
          shifts: shifts
            .filter((s) => (request?.shift_ids || []).includes(s.id))
            .map((s) => ({
              date: s.start_date,
              start_time: s.start_time,
              end_time: s.end_time,
            })),
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      toast.success("המשמרות נלקחו בהצלחה!");
    },
    onError: (error) => {
      console.error("❌ [ShiftCalendar] Accept general request failed:", error);
      toast.error(`ביצוע ההחלפה נכשל: ${error?.message || "שגיאה לא ידועה"}`);
    },
  });

  // Start a head-to-head counter-offer against someone else's general/open
  // request: the target (the requester's offered shifts) is pre-filled, and
  // the user only picks their OWN shifts to offer in exchange. Reuses
  // switchRequestMutation, which builds a Head2Head request from the current
  // user to the target owner; the original requester then accepts it from
  // their incoming requests (acceptHeadToHeadRequestMutation).
  const handleStartCounterOffer = (request) => {
    if (!canTakeShifts) {
      showRoleError();
      return;
    }
    const targetShiftIds = request.shift_ids || [];
    if (targetShiftIds.length === 0) return;
    const targetShift = shifts.find((s) => s.id === targetShiftIds[0]);
    const targetOwner = allUsers.find(
      (u) =>
        Number(u.serial_id) === Number(resolveOwnerId(targetShift, coverages)),
    );
    setShowKPIListModal(false);
    if (switchFlowWarningTimeoutRef.current)
      clearTimeout(switchFlowWarningTimeoutRef.current);
    setSwitchFlowWarning(null);
    setSwitchFlow({
      step: "own",
      ownShiftIds: [],
      targetShiftIds,
      isCounterOffer: true,
      targetOwnerName: targetOwner?.full_name || "",
    });
  };

  const cancelSwapMutation = useMutation({
    mutationFn: async (shiftId) => {
      // Find and cancel the swap request — including ones already fully
      // "Closed" (fully covered by helpers), not just Open/Partially_Covered.
      // The owner can undo a fully-accepted partial swap too, and leaving a
      // Closed request in place would keep matching normalizeShiftContext's
      // activeRequest lookup (same requesting_user_id/owner) forever,
      // making the reverted shift look "covered" again even after everyone's
      // coverage was just cancelled below.
      const activeRequest = swapRequests.find(
        (sr) =>
          sr.shift_ids?.includes(shiftId) &&
          ["Open", "Partially_Covered", "Closed"].includes(sr.status),
      );
      if (activeRequest) {
        await base44.entities.SwapRequest.update(activeRequest.id, {
          status: "Cancelled",
        });
      }

      // Cancelling the owner's own partial/full swap request means the whole
      // shift just returns to them as a normal shift — delete the "cover" rows
      // other people were granted (cancel = delete; Phase 4). The base
      // "assignment" row is left untouched so ownership is preserved.
      return await Promise.all(
        coverages
          .filter((c) => c.shift_id === shiftId && c.type !== "assignment")
          .map((c) => base44.entities.ShiftCoverage.delete(c.id)),
      );
    },
    onSuccess: (_data, shiftId) => {
      const shift = shifts.find((s) => s.id === shiftId);
      logActivity({
        action: "ביטול בקשת החלפה של המשמרת",
        type: "בקשות החלפה",
        entity: "SwapRequest",
        entityId: shiftId,
        details: {
          request_type: "ביטול בקשת החלפה",
          requester: authorizedPerson?.full_name,
          shifts: shift
            ? [
                {
                  date: shift.start_date,
                  start_time: shift.start_time,
                  end_time: shift.end_time,
                },
              ]
            : [],
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      queryClient.invalidateQueries(["coverages"]);
      toast.success("הבקשה בוטלה והמשמרת חזרה לסטטוס רגיל");
      setShowDetailsModal(false);
    },
  });

  // Lets a user who joined a partial swap back out of the window they took —
  // it's removed and, by default, the original owner simply keeps that time
  // (missingSegments already treats anything nobody covers as theirs), so no
  // separate "give it back" step is needed beyond cancelling this coverage.
  const cancelMyCoverageMutation = useMutation({
    mutationFn: async (shift) => {
      const myCoverage = coverages.find(
        (c) =>
          c.shift_id === shift.id &&
          c.type !== "assignment" &&
          Number(c.covering_user_id) === Number(authorizedPerson.serial_id),
      );
      if (!myCoverage) throw new Error("No coverage found to cancel");

      // Backing out of a covered window = delete the cover row (Phase 4). The
      // owner keeps whatever nobody covers (missingSegments treats it as theirs).
      await base44.entities.ShiftCoverage.delete(myCoverage.id);

      const activeRequest = swapRequests.find(
        (sr) => sr.shift_ids?.includes(shift.id) && sr.status !== "Cancelled",
      );
      if (activeRequest) {
        const remainingCoverages = coverages.filter(
          (c) =>
            c.shift_id === shift.id &&
            c.type !== "assignment" &&
            c.id !== myCoverage.id,
        );
        await base44.entities.SwapRequest.update(activeRequest.id, {
          status: remainingCoverages.length > 0 ? "Partially_Covered" : "Open",
        });
      }
      // The shift's status is derived from the (re-opened) request above — no
      // Shift.status to write (Phase 4).
    },
    onSuccess: (_data, shift) => {
      logActivity({
        action: "ביטול השתתפות בכיסוי משמרת",
        type: "בקשות החלפה",
        entity: "ShiftCoverage",
        entityId: shift?.id,
        details: {
          shifts: shift
            ? [
                {
                  date: shift.start_date,
                  start_time: shift.start_time,
                  end_time: shift.end_time,
                },
              ]
            : [],
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      queryClient.invalidateQueries(["coverages"]);
      toast.success("ביטלת את השתתפותך במשמרת");
      setShowDetailsModal(false);
    },
    onError: (error) => {
      toast.error(`ביטול ההשתתפות נכשל: ${error?.message || "שגיאה לא ידועה"}`);
    },
  });

  // Cancels a SwapRequest directly by its own id (used by KPIListModal, where
  // we already have the request object in hand instead of a single shiftId).
  // Unlike cancelSwapMutation this handles requests bundling multiple
  // shift_ids, and avoids resetting a shift to Active if another open request
  // still references it.
  const cancelSwapRequestMutation = useMutation({
    mutationFn: async (request) => {
      await base44.entities.SwapRequest.update(request.id, {
        status: "Cancelled",
      });

      const shiftIds = request.shift_ids || [];
      const shiftsToReset = shiftIds.filter(
        (id) =>
          !swapRequests.some(
            (sr) =>
              sr.id !== request.id &&
              ["Open", "Partially_Covered"].includes(sr.status) &&
              sr.shift_ids?.includes(id),
          ),
      );

      // As with cancelSwapMutation: any coverage already granted on these
      // shifts no longer applies once the request itself is cancelled — delete
      // the "cover" rows (cancel = delete; Phase 4). Assignment rows are kept.
      await Promise.all(
        coverages
          .filter(
            (c) =>
              shiftsToReset.includes(c.shift_id) && c.type !== "assignment",
          )
          .map((c) => base44.entities.ShiftCoverage.delete(c.id)),
      );
      // The reset shifts' status is derived from the absence of a live request
      // (Phase 4) — nothing to write on the Shift.
    },
    onSuccess: (_data, request) => {
      logActivity({
        action: "ביטול בקשת החלפה",
        type: "בקשות החלפה",
        entity: "SwapRequest",
        entityId: request?.id,
        details: {
          requester: allUsers.find(
            (u) =>
              Number(u.serial_id) === Number(request?.requesting_user_id),
          )?.full_name,
          shifts: shifts
            .filter((s) => (request?.shift_ids || []).includes(s.id))
            .map((s) => ({
              date: s.start_date,
              start_time: s.start_time,
              end_time: s.end_time,
            })),
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      queryClient.invalidateQueries(["coverages"]);
      toast.success("הבקשה בוטלה והמשמרת חזרה לסטטוס רגיל");
    },
    onError: (error) => {
      console.error("❌ [ShiftCalendar] Cancel swap request failed:", error);
      toast.error(`ביטול הבקשה נכשל: ${error?.message || "שגיאה לא ידועה"}`);
    },
  });

  // Accepts an incoming Head2Head request: the accepting user gives up every
  // shift in offered_shift_ids (their own shifts this request is asking for)
  // in exchange for every shift in shift_ids (the requester's offered pool) —
  // a full trade of both lists, matching how the request was created.
  // Reassignment is done via original_user_id, the same field EditRoleModal
  // uses; assigned_person/email/role/department are display-only and get
  // re-derived from original_user_id when shifts render.
  const acceptHeadToHeadRequestMutation = useMutation({
    mutationFn: async (request) => {
      const theirShiftIds = request.shift_ids || [];
      const myShiftIds = request.offered_shift_ids || [];

      // A head-to-head trade permanently reassigns ownership on both sides —
      // point each traded shift's base "assignment" coverage row at its new
      // owner (Phase 4: ownership lives in coverage, not on the Shift).
      await Promise.all([
        ...myShiftIds.map((id) =>
          syncAssignmentOwner(id, request.requesting_user_id, coverages),
        ),
        ...theirShiftIds.map((id) =>
          syncAssignmentOwner(id, authorizedPerson.serial_id, coverages),
        ),
      ]);

      await base44.entities.SwapRequest.update(request.id, {
        status: "Closed",
      });

      // Any other open request still trading one of these shifts (on either
      // side) assumed an ownership that no longer holds — cancel it too.
      const swappedIds = [...theirShiftIds, ...myShiftIds];
      const staleSiblings = swapRequests.filter(
        (sr) =>
          sr.id !== request.id &&
          ["Open", "Partially_Covered"].includes(sr.status) &&
          (sr.shift_ids?.some((id) => swappedIds.includes(id)) ||
            sr.offered_shift_ids?.some((id) => swappedIds.includes(id))),
      );
      await Promise.all(
        staleSiblings.map((sr) =>
          base44.entities.SwapRequest.update(sr.id, { status: "Cancelled" }),
        ),
      );
    },
    onSuccess: (_data, request) => {
      const snap = (ids) =>
        shifts
          .filter((s) => (ids || []).includes(s.id))
          .map((s) => ({
            date: s.start_date,
            start_time: s.start_time,
            end_time: s.end_time,
          }));
      logActivity({
        action: "קבלת בקשת החלפה ראש-בראש",
        type: "בקשות החלפה",
        entity: "SwapRequest",
        entityId: request?.id,
        details: {
          request_type: "ראש-בראש",
          from: allUsers.find(
            (u) =>
              Number(u.serial_id) === Number(request?.requesting_user_id),
          )?.full_name,
          to: authorizedPerson?.full_name,
          requested_shifts: snap(request?.shift_ids),
          offered_shifts: snap(request?.offered_shift_ids),
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      toast.success("ההחלפה בוצעה בהצלחה!");
    },
    onError: (error) => {
      console.error(
        "❌ [ShiftCalendar] Accept head-to-head request failed:",
        error,
      );
      toast.error(`ביצוע ההחלפה נכשל: ${error?.message || "שגיאה לא ידועה"}`);
    },
  });

  // "Gift": an RR user offers to take today's shift off whoever is doing it,
  // no strings attached. It is NOT applied immediately — it's sent as a
  // SwapRequest (request_type "Gift") that the recipient must accept from
  // their incoming-requests list, so they stay in control of their own shift.
  // Modeled on the existing SwapRequest entity (no schema change): the gifted
  // shift sits in shift_ids and requesting_user_id is the giver — on accept,
  // acceptGiftMutation moves that shift to the giver. Because requesting_user_id
  // (giver) != the shift's original_user_id (recipient), normalizeShiftContext
  // never treats this as the shift's active_request, so the shift keeps
  // rendering normally until the recipient accepts.
  const giftShiftMutation = useMutation({
    mutationFn: async (shift) => {
      // Don't stack two open gift offers on the same shift.
      const existingGift = swapRequests.find(
        (sr) =>
          sr.request_type === "Gift" &&
          sr.status === "Open" &&
          sr.shift_ids?.includes(shift.id),
      );
      if (existingGift) {
        throw new Error("כבר קיימת הצעת מתנה פתוחה למשמרת זו");
      }
      // Record the current owner (the recipient who'll accept and be freed)
      // now — on accept the shift moves to the giver, so it can't be recovered
      // later for the history view. Resolve from the assignment coverage row
      // (Phase 4), falling back to the enriched shift's owner id.
      const recipientId =
        resolveOwnerId(shift, coverages) ??
        (shift.original_user_id != null
          ? Number(shift.original_user_id)
          : undefined);
      return base44.entities.SwapRequest.create({
        shift_ids: [shift.id],
        offered_shift_ids: [],
        requesting_user_id: authorizedPerson.serial_id,
        request_type: "Gift",
        gift_recipient_id: recipientId,
        req_start_date: shift.start_date,
        req_end_date: shift.end_date || shift.start_date,
        req_start_time: shift.start_time || "09:00",
        req_end_time: shift.end_time || shift.start_time || "09:00",
        status: "Open",
      });
    },
    onSuccess: (_data, shift) => {
      logActivity({
        action: "הצעת משמרת במתנה",
        type: "בקשות החלפה",
        entity: "SwapRequest",
        entityId: shift?.id,
        details: {
          request_type: "מתנה",
          giver: authorizedPerson?.full_name,
          to:
            allUsers.find(
              (u) => Number(u.serial_id) === Number(shift?.original_user_id),
            )?.full_name || shift?.original_user_name,
          shifts: shift
            ? [
                {
                  date: shift.start_date,
                  start_time: shift.start_time,
                  end_time: shift.end_time,
                },
              ]
            : [],
        },
      });
      queryClient.invalidateQueries(["swap-requests"]);
      const recipientName =
        allUsers.find(
          (u) => Number(u.serial_id) === Number(shift.original_user_id),
        )?.full_name ||
        shift.original_user_name ||
        "המשתמש";
      // The WhatsApp option lives on the giver's success toast (per request),
      // as an optional action rather than an automatic redirect.
      toast.success(`הצעת המתנה נשלחה ל${recipientName} 🎁 — ממתינה לאישור`, {
        duration: 10000,
        action: {
          label: "שליחה בוואטסאפ",
          onClick: () => {
            const message = buildGiftTemplate({
              recipientName,
              giverName: authorizedPerson.full_name,
              startDate: shift.start_date,
              startTime: shift.start_time,
              endDate: shift.end_date,
              endTime: shift.end_time,
              requestId: _data?.id,
            });
            window.open(
              `https://wa.me/?text=${encodeURIComponent(message)}`,
              "_blank",
            );
          },
        },
      });
    },
    onError: (error) => {
      console.error("❌ [ShiftCalendar] Gift shift failed:", error);
      toast.error(`שליחת המתנה נכשלה: ${error?.message || "שגיאה לא ידועה"}`);
    },
  });

  // Recipient accepts a gift offer: the gifted shift(s) (shift_ids) move to the
  // giver (requesting_user_id), the request closes, and any other open request
  // still referencing those shifts is cancelled as no longer valid. Mirrors
  // acceptHeadToHeadRequestMutation, but one-directional (nothing goes back).
  const acceptGiftMutation = useMutation({
    mutationFn: async (request) => {
      const giftedShiftIds = request.shift_ids || [];
      if (giftedShiftIds.length === 0) return;

      // Accepting a gift permanently hands each shift to the giver — point its
      // base "assignment" coverage row at them (Phase 4: ownership = coverage).
      await Promise.all(
        giftedShiftIds.map((id) =>
          syncAssignmentOwner(id, request.requesting_user_id, coverages),
        ),
      );

      await base44.entities.SwapRequest.update(request.id, {
        status: "Closed",
      });

      const staleSiblings = swapRequests.filter(
        (sr) =>
          sr.id !== request.id &&
          ["Open", "Partially_Covered"].includes(sr.status) &&
          (sr.shift_ids?.some((id) => giftedShiftIds.includes(id)) ||
            sr.offered_shift_ids?.some((id) => giftedShiftIds.includes(id))),
      );
      await Promise.all(
        staleSiblings.map((sr) =>
          base44.entities.SwapRequest.update(sr.id, { status: "Cancelled" }),
        ),
      );
    },
    onSuccess: (_data, request) => {
      logActivity({
        action: "קבלת משמרת במתנה",
        type: "בקשות החלפה",
        entity: "SwapRequest",
        entityId: request?.id,
        details: {
          request_type: "מתנה",
          giver: allUsers.find(
            (u) =>
              Number(u.serial_id) === Number(request?.requesting_user_id),
          )?.full_name,
          taker: authorizedPerson?.full_name,
          shifts: shifts
            .filter((s) => (request?.shift_ids || []).includes(s.id))
            .map((s) => ({
              date: s.start_date,
              start_time: s.start_time,
              end_time: s.end_time,
            })),
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      toast.success("המתנה התקבלה — אין צורך להגיע למשמרת 🎁");
    },
    onError: (error) => {
      console.error("❌ [ShiftCalendar] Accept gift failed:", error);
      toast.error(`קבלת המתנה נכשלה: ${error?.message || "שגיאה לא ידועה"}`);
    },
  });

  const offerCoverMutation = useMutation({
    mutationFn: async ({ shift, coverData }) => {
      const normalizedShift = normalizeShiftContext(shift, {
        allUsers,
        swapRequests,
        coverages,
        currentUser: authorizedPerson,
      });

      // Find active swap request. Once one person partially covers a shift,
      // the request's status flips to "Partially_Covered" (not "Open") so
      // other people can keep taking the remaining windows — the lookup must
      // accept that status too, or it'll wrongly report no active request.
      const activeRequest =
        normalizedShift?.active_request ||
        swapRequests.find(
          (sr) => sr.shift_ids?.includes(shift.id) && sr.status !== "Cancelled",
        );
      if (!activeRequest) throw new Error("No active swap request found");

      const payload = {
        shift_id: shift.id,
        covering_user_id: authorizedPerson.serial_id,
        cover_start_date:
          coverData.startDate ||
          coverData.coverDate ||
          normalizedShift.start_date,
        cover_end_date:
          coverData.endDate || coverData.coverDate || normalizedShift.end_date,
        cover_start_time: coverData.startTime || normalizedShift.start_time,
        cover_end_time: coverData.endTime || normalizedShift.end_time,
        // A swap/partial takeover layered over the base assignment row. Full vs
        // partial is derived from the window, not stored here (schema:
        // ShiftCoverage.type is "assignment" | "cover").
        type: "cover",
      };

      // If the user already has a coverage on this shift, update it in place
      // instead of creating a second row, so they can edit what they chose.
      if (coverData.coverageId) {
        await base44.entities.ShiftCoverage.update(
          coverData.coverageId,
          payload,
        );
      } else {
        await base44.entities.ShiftCoverage.create(payload);
      }

      // Evaluate remaining gaps after this coverage to decide the request's
      // status (the shift's own status is derived from that request; Phase 4).
      const shiftCoverages = [
        ...coverages.filter(
          (c) =>
            c.shift_id === shift.id &&
            c.type !== "assignment" &&
            c.id !== coverData.coverageId,
        ),
        { ...payload, id: coverData.coverageId },
      ];

      const { missingSegments } = computeCoverageSummary({
        shift: normalizedShift,
        activeRequest,
        coverages: shiftCoverages,
      });

      await base44.entities.SwapRequest.update(activeRequest.id, {
        status: missingSegments.length === 0 ? "Closed" : "Partially_Covered",
      });
    },
    onSuccess: (_data, { shift } = {}) => {
      logActivity({
        action: "הצעת כיסוי למשמרת",
        type: "בקשות החלפה",
        entity: "ShiftCoverage",
        entityId: shift?.id,
        details: {
          request_type: "כיסוי משמרת",
          shifts: shift
            ? [
                {
                  date: shift.start_date,
                  start_time: shift.start_time,
                  end_time: shift.end_time,
                },
              ]
            : [],
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      queryClient.invalidateQueries(["coverages"]);
      toast.success("הצעת הכיסוי נשלחה בהצלחה!");
      setShowAcceptSwapModal(false);
      setShowDetailsModal(false);
    },
  });

  const headToHeadSwapMutation = useMutation({
    mutationFn: async () => {
      if (!h2hTargetId || !h2hOfferId) return;

      const targetShift = shifts.find((s) => s.id === h2hTargetId);
      const offerShift = shifts.find((s) => s.id === h2hOfferId);

      // Swap ownership: each shift's base "assignment" coverage row moves to the
      // other shift's owner (Phase 4: ownership lives in coverage, not on the
      // Shift's assigned_* fields, which are re-derived from the owner on render).
      const targetOwner = resolveOwnerId(targetShift, coverages);
      const offerOwner = resolveOwnerId(offerShift, coverages);
      await syncAssignmentOwner(h2hTargetId, offerOwner, coverages);
      await syncAssignmentOwner(h2hOfferId, targetOwner, coverages);
    },
    onSuccess: () => {
      logActivity({
        action: "ביצוע החלפה ראש-בראש",
        type: "בקשות החלפה",
        entity: "ShiftCoverage",
        entityId: h2hTargetId,
        details: {
          request_type: "ראש-בראש",
          shifts: shifts
            .filter((s) => [h2hTargetId, h2hOfferId].includes(s.id))
            .map((s) => ({
              date: s.start_date,
              start_time: s.start_time,
              end_time: s.end_time,
            })),
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["coverages"]);
      toast.success("החלפה ראש בראש בוצעה בהצלחה!");
      setShowHeadToHeadApproval(false);
      setH2hTargetId(null);
      setH2hOfferId(null);
    },
  });

  const approveSwapMutation = useMutation({
    mutationFn: async (shift) => {
      // Find the pending coverage
      const coverages = await base44.entities.ShiftCoverage.filter({
        shift_id: shift.id,
      });
      const pendingCoverage = coverages[0]; // Assuming one pending for simplicity

      if (!pendingCoverage) return;

      // Update Shift with new assignee (Shift.status removed in Phase 4).
      await base44.entities.Shift.update(shift.id, {
        assigned_person: pendingCoverage.covering_person,
        assigned_email: pendingCoverage.covering_email,
        role: pendingCoverage.covering_role, // Or keep original role name if preferred
        swap_start_time: null,
        swap_end_time: null,
      });

      // Update Coverage status (optional if you have status field on coverage)
      // await base44.entities.ShiftCoverage.update(pendingCoverage.id, { status: 'approved' });
    },
    onSuccess: (_data, shift) => {
      logActivity({
        action: "אישור החלפה ועדכון הלוח",
        type: "בקשות החלפה",
        entity: "Shift",
        entityId: shift?.id,
        details: {
          shifts: shift
            ? [
                {
                  date: shift.start_date,
                  start_time: shift.start_time,
                  end_time: shift.end_time,
                },
              ]
            : [],
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      toast.success("ההחלפה אושרה והלוח עודכן!");
      setShowDetailsModal(false);
    },
  });

  const addShiftMutation = useMutation({
    mutationFn: async (newShiftData) => {
      // Shift is now a pure time slot (Phase 4) — ownership is recorded solely
      // in its base "assignment" coverage row, created right after.
      const shift = await base44.entities.Shift.create({
        start_date: newShiftData.start_date,
        end_date: newShiftData.end_date,
        start_time: newShiftData.start_time || "09:00",
        end_time: newShiftData.end_time || "09:00",
      });
      await createAssignmentForShift(shift, newShiftData.original_user_id);
      return shift;
    },
    onSuccess: (shift, newShiftData) => {
      logActivity({
        action: "הוספת משמרת",
        type: "הוספת משמרות",
        entity: "Shift",
        entityId: shift?.id,
        details: {
          owner: allUsers.find(
            (u) =>
              Number(u.serial_id) === Number(newShiftData?.original_user_id),
          )?.full_name,
          shifts: shift
            ? [
                {
                  date: shift.start_date,
                  start_time: shift.start_time,
                  end_time: shift.end_time,
                },
              ]
            : [],
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["coverages"]);
      toast.success("המשמרת נוספה בהצלחה");
      setShowAddShiftModal(false);
    },
  });

  const editRoleMutation = useMutation({
    mutationFn: async ({ id, original_user_id, ...data }) => {
      // EditRoleModal reassigns ownership — that now lives in the base
      // "assignment" coverage row, not on the Shift (Phase 4).
      if (original_user_id != null) {
        await syncAssignmentOwner(id, original_user_id, coverages);
      }
      // Any remaining (non-ownership) slot fields still update the Shift itself.
      if (Object.keys(data).length > 0) {
        return base44.entities.Shift.update(id, data);
      }
      return null;
    },
    onSuccess: (_data, variables) => {
      const editedShift = shifts.find((s) => s.id === variables?.id);
      logActivity({
        action: "עריכת תפקיד / בעלות על משמרת",
        type: "שינויים בהרשאות",
        entity: "Shift",
        entityId: variables?.id,
        details: {
          new_owner:
            variables?.original_user_id != null
              ? allUsers.find(
                  (u) =>
                    Number(u.serial_id) ===
                    Number(variables.original_user_id),
                )?.full_name
              : undefined,
          shifts: editedShift
            ? [
                {
                  date: editedShift.start_date,
                  start_time: editedShift.start_time,
                  end_time: editedShift.end_time,
                },
              ]
            : [],
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["coverages"]);
      toast.success("התפקיד עודכן בהצלחה");
      setShowEditRoleModal(false);
      setShowActionModal(false);
    },
  });

  const deleteShiftMutation = useMutation({
    mutationFn: async (id) => {
      // A covered shift still has SwapRequest / ShiftCoverage rows pointing
      // at it (shift_ids / offered_shift_ids / shift_id) — Base44 rejects
      // deleting an entity that's still referenced elsewhere, which made
      // this silently no-op for any shift with full/partial coverage. Clear
      // those referencing rows first so the shift delete can actually go
      // through.
      const relatedRequests = swapRequests.filter(
        (r) => r.shift_ids?.includes(id) || r.offered_shift_ids?.includes(id),
      );
      const relatedCoverages = coverages.filter((c) => c.shift_id === id);
      await Promise.all([
        ...relatedRequests.map((r) => base44.entities.SwapRequest.delete(r.id)),
        ...relatedCoverages.map((c) =>
          base44.entities.ShiftCoverage.delete(c.id),
        ),
      ]);
      return await base44.entities.Shift.delete(id);
    },
    onSuccess: (_data, id) => {
      const deletedShift = shifts.find((s) => s.id === id);
      const deletedOwnerId = deletedShift
        ? resolveOwnerId(deletedShift, coverages)
        : null;
      logActivity({
        action: "מחיקת משמרת",
        type: "מחיקת משמרות",
        entity: "Shift",
        entityId: id,
        details: {
          owner: allUsers.find(
            (u) => Number(u.serial_id) === Number(deletedOwnerId),
          )?.full_name,
          shifts: deletedShift
            ? [
                {
                  date: deletedShift.start_date,
                  start_time: deletedShift.start_time,
                  end_time: deletedShift.end_time,
                },
              ]
            : [],
        },
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      queryClient.invalidateQueries(["coverages"]);
      toast.success("המשמרת נמחקה");
      setShowActionModal(false);
      setShowDetailsModal(false);
    },
    onError: (error) => {
      console.error("❌ [ShiftCalendar] Delete shift failed:", error);
      toast.error(`מחיקת המשמרת נכשלה: ${error?.message || "שגיאה לא ידועה"}`);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      // Log the logout before the auth call — the redirect in onSuccess tears
      // the app down, so a post-logout fire-and-forget wouldn't survive.
      await logActivity({
        action: "התנתקות מהמערכת",
        type: "כניסות משתמשים",
        entity: "User",
      });
      await base44.auth.logout();
    },
    onSuccess: () => {
      window.location.href = "/";
    },
    onError: () => {
      toast.error("אירעה שגיאה בעת ההתנתקות");
    },
  });

  // --- HANDLERS ---
  const closeAllModals = () => {
    setShowSwapRequestModal(false);
    setShowAddShiftModal(false);
    setShowAcceptSwapModal(false);
    setShowActionModal(false);
    setShowEditRoleModal(false);
    setShowDetailsModal(false);
    setShowAdminSettings(false);
    setShowHallOfFame(false);
    setShowFairnessMatrix(false);
    setShowHelpSupport(false);
    setShowLogoutConfirm(false);
    setShowSuccessModal(false);
    setShowHeadToHeadSelector(false);
    setShowHeadToHeadApproval(false);
    setTourGiftConfirm(false);
    setH2hTargetId(null);
    setH2hOfferId(null);
    setShowKPIListModal(false);
  };

  const handleCellClick = (date, shift) => {
    setClickedDate(date); // Fix: Save the clicked date for Add Modal

    // Check Date Validity (Prevent editing past)
    const clickedDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    clickedDate.setHours(0, 0, 0, 0);
    const isPast = clickedDate < today;

    if (switchFlow) {
      // "Active"/"regular" both mean a plain, unswapped shift (see HeadToHeadSelectorModal's isWhiteShift check).
      const isPlainShiftStatus =
        shift &&
        ["active", "regular"].includes(
          String(shift.status || "Active").toLowerCase(),
        );
      const isEligible =
        !!shift && (switchFlow.step === "own" ? shift.isMine : !shift.isMine);

      if (!isPlainShiftStatus || isPast || !isEligible) return;

      // Picking a TARGET shift means taking someone else's shift — blocked
      // for anyone who is not the active member of their group. Picking an OWN
      // shift (giving it away) is always allowed regardless of that standing.
      if (switchFlow.step === "target" && !canTakeShifts) {
        showRoleError();
        return;
      }

      // Target shifts can only belong to one other person per request (see
      // switchRequestMutation, which groups offered_shift_ids by owner) — block
      // adding a shift owned by someone else once a target owner is set.
      if (
        switchFlow.step === "target" &&
        shift &&
        !switchFlow.targetShiftIds.includes(shift.id) &&
        switchFlow.targetShiftIds.length > 0
      ) {
        const firstTargetShift = shifts.find(
          (s) => s.id === switchFlow.targetShiftIds[0],
        );
        if (
          firstTargetShift &&
          // `shifts` is raw, so resolve ownership from the assignment coverage
          // row on both sides (Shift.original_user_id was removed in Phase 4).
          resolveOwnerId(firstTargetShift, coverages) !==
            resolveOwnerId(shift, coverages)
        ) {
          if (switchFlowWarningTimeoutRef.current)
            clearTimeout(switchFlowWarningTimeoutRef.current);
          setSwitchFlowWarning(
            "אי אפשר לבחור משמרות של יותר מאדם אחד בבקשת ראש בראש אחת",
          );
          switchFlowWarningTimeoutRef.current = setTimeout(
            () => setSwitchFlowWarning(null),
            3000,
          );
          return;
        }
      }

      const listKey =
        switchFlow.step === "own" ? "ownShiftIds" : "targetShiftIds";
      setSwitchFlow((prev) => {
        const list = prev[listKey];
        const nextList = list.includes(shift.id)
          ? list.filter((id) => id !== shift.id)
          : [...list, shift.id];
        return { ...prev, [listKey]: nextList };
      });
      return;
    }

    if (!shift) {
      if (isAdmin && !isPast) {
        setShowAddShiftModal(true);
      }
      return;
    }

    // Permissions & ownership
    const permissionLevel = authorizedPerson.permissions;
    // A "Viewer" mirrors RR's viewing access (same shifts/details are openable);
    // every action is separately blocked by the isViewer read-only overlay.
    const isRR = permissionLevel === "RR" || permissionLevel === "Viewer";
    const isMyShift =
      shift.original_user_id === authorizedPerson.serial_id ||
      shift.assigned_email === authorizedPerson.email;
    const isCoveredShift =
      shift.status === "covered" ||
      shift.status === "Covered" ||
      shift.status === "approved";
    const isCoveringUser = (shift.coverages || []).some(
      (cov) => cov.covering_user_id === authorizedPerson.serial_id,
    );

    // Access rules for RR level
    if (isRR && !isAdmin) {
      // NOTE: a plain "regular" shift that isn't mine is intentionally NOT
      // blocked here — an RR user must be able to open it (read-only details,
      // and to gift/offer where eligible). It falls through to the details
      // modal below.

      if (isCoveredShift && !(isMyShift || isCoveringUser)) {
        return;
      }

      // Swap requests are always viewable for RR (covered by default fallthrough)
    }

    setSelectedShift(shift);

    // Determine if it's my shift
    if (shift.status === "regular") {
      // A read-only viewer gets the details modal (all action buttons already
      // suppressed there) rather than the action modal, whose only non-admin
      // option is opening a swap request they aren't allowed to create.
      if (isMyShift && !isPast && !isViewer) {
        setShowActionModal(true);
      } else {
        setShowDetailsModal(true); // View details for others
      }
    } else {
      // Swap requested, Pending, etc.
      setShowDetailsModal(true);
    }
  };

  // Open the requests menu (swap_requests / "all" tab) focused on one specific
  // request — used by "אני רוצה לעזור!" on a full-coverage request, which
  // routes the helper straight to the request the shift owner created.
  const handleGoToRequest = (request) => {
    closeAllModals();
    setKpiFocusRequestId(request?.id || null);
    setKpiListType("swap_requests");
    setKpiInitialTab("all");
    setKpiOpenSeq((n) => n + 1);
    setShowKPIListModal(true);
  };

  const handleOfferCover = (shift) => {
    if (!canTakeShifts) {
      showRoleError();
      return;
    }
    const normalized = normalizeShiftContext(shift, {
      allUsers,
      swapRequests,
      coverages,
      currentUser: authorizedPerson,
    });
    setSelectedShift(normalized);
    setShowAcceptSwapModal(true);
  };

  const handleOpenSwapRequest = (shift) => {
    if (!canTakeShifts) {
      showRoleError();
      return;
    }
    setSelectedShift(shift);
    setSwapRequestInitialType("full");
    setShowSwapRequestModal(true);
  };

  const handleSwapSubmit = (data) => {
    // Final choke point for the read-only viewer overlay: no swap request is
    // ever created regardless of which entry point opened the form.
    if (isViewer) {
      showRoleError();
      return;
    }
    if (!selectedShift) {
      debugLog(
        "❌ [ShiftCalendar] No shift selected for swap request submission",
      );
      appendSwapLog("❌ לא נבחרה משמרת לשליחה");
      return;
    }

    appendSwapLog("📝 נתוני בקשה מהמודל", data);
    debugLog("📤 [ShiftCalendar] Submitting swap request from modal:", data);

    requestSwapMutation.mutate({
      shiftId: selectedShift.id,
      type: data.type,
      dates: data,
    });
  };

  // --- RENDER LOGIC ---

  // 1. Loading State
  if (isUserLoading || isAuthCheckLoading) {
    return (
      <div
        className="min-h-screen bg-[#F9FAFB] flex items-center justify-center"
        dir="rtl"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
          <p className="text-gray-500 font-medium">מאמת נתונים...</p>
        </div>
      </div>
    );
  }

  // 2. Access Denied (User not in AuthorizedPerson table)
  if (!authorizedPerson) {
    return <UserNotRegisteredError onRefresh={refreshAuthCheck} />;
  }

  // 2b. Access Blocked ('None' permission — also catches any not-yet-migrated
  // legacy 'View' rows, since that permission no longer exists going forward).
  if (["None", "View"].includes(authorizedPerson.permissions)) {
    return (
      <UserNotRegisteredError
        onRefresh={refreshAuthCheck}
        title="הגישה חסומה"
        message="למשתמש שלך אין הרשאת כניסה למערכת. פנה למנהל המערכת לקבלת הרשאה מתאימה."
      />
    );
  }

  // 3. First Time Onboarding (User authorized but not yet activated)
  if (!currentUser?.is_authorized) {
    return (
      <OnboardingModal
        isOpen={true}
        authorizedData={authorizedPerson}
        onConfirm={() => linkUserMutation.mutate()}
        isLoading={linkUserMutation.isPending}
      />
    );
  }

  // 4. Main App (User authorized and linked)
  const permissionLevel = authorizedPerson.permissions;
  const isAdmin = permissionLevel === "Admin" || permissionLevel === "Manager";
  const isLoadingApp = isUserLoading || isAuthCheckLoading || isShiftsLoading;

  if (isLoadingApp) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] text-gray-900" dir="rtl">
        <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
          <LoadingSkeleton className="h-14 w-full" ariaLabel="טוען כותרת" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, idx) => (
              <LoadingSkeleton
                key={idx}
                className="h-16"
                ariaLabel="טעינת KPI"
              />
            ))}
          </div>
          <LoadingSkeleton
            className="h-[420px] w-full"
            ariaLabel="טעינת לוח משמרות"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[#F9FAFB] text-gray-900 font-sans selection:bg-blue-100 overflow-x-hidden relative"
      dir="rtl"
    >
      <BackgroundShapes />

      <div className="max-w-7xl mx-auto px-4 py-4 md:py-8 relative z-10 flex flex-col min-h-screen">
        {/* Header (top bar + branding only, navigation rendered below the KPI band) */}
        <CalendarHeader
          currentDate={currentDate}
          setCurrentDate={setCurrentDate}
          viewMode={viewMode}
          setViewMode={setViewMode}
          isAdmin={isAdmin}
          onOpenAdminSettings={() => setShowAdminSettings(true)}
          onOpenHallOfFame={() => setShowHallOfFame(true)}
          onOpenFairnessMatrix={() => setShowFairnessMatrix(true)}
          onOpenHelp={() => setShowHelpSupport(true)}
          onLogout={() => setShowLogoutConfirm(true)}
          currentUser={authorizedPerson}
          hideNavigation={true}
        />

        {/* KPI Header */}
        <div className="mb-2">
          <KPIHeader
            shifts={enrichedShifts}
            currentUser={authorizedPerson}
            onKPIClick={(type) => {
              setKpiListType(type);
              setKpiInitialTab("all");
              setKpiOpenSeq((n) => n + 1);
              setShowKPIListModal(true);
            }}
            onStartSwitchFlow={() => {
              // A read-only viewer may not start a switch flow (it ends in a new
              // swap request); the rest of the KPI band stays fully viewable.
              if (isViewer) {
                showRoleError();
                return;
              }
              // Jump to the first month where the user actually has a future
              // shift they can offer. Otherwise the switch-flow band shows
              // every cell dimmed (the current month's own shifts may all be
              // in the past) and it looks like nothing is selectable.
              const todayStr = format(new Date(), "yyyy-MM-dd");
              const myFutureShifts = enrichedShifts.filter(
                (s) =>
                  s.isMine &&
                  s.start_date &&
                  s.start_date >= todayStr &&
                  ["active", "regular"].includes(
                    String(s.status || "Active").toLowerCase(),
                  ),
              );
              if (myFutureShifts.length > 0) {
                const earliest = myFutureShifts
                  .map((s) => s.start_date)
                  .sort()[0];
                setCurrentDate(new Date(earliest + "T00:00:00"));
              }
              setSwitchFlow({
                step: "own",
                ownShiftIds: [],
                targetShiftIds: [],
              });
            }}
          />
        </div>

        {/* Navigation (view mode + prev/next month) */}
        <CalendarHeader
          currentDate={currentDate}
          setCurrentDate={setCurrentDate}
          viewMode={viewMode}
          setViewMode={setViewMode}
          isAdmin={isAdmin}
          currentUser={authorizedPerson}
          hideHeader={true}
        />

        {/* Calendar Grid */}
        <div
          className="flex-1 bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl border border-white/50 p-2 md:p-6 mt-1 relative overflow-hidden"
          data-tour="calendar-grid"
        >
          <CalendarGrid
            currentDate={currentDate}
            viewMode={viewMode}
            shifts={enrichedShifts}
            onCellClick={handleCellClick}
            currentUserEmail={authorizedPerson.email}
            currentUserRole={authorizedPerson.full_name}
            isAdmin={isAdmin}
            switchFlow={switchFlow}
            considerationsByDate={considerationsByDate}
            onConsiderationClick={(date, items) =>
              setConsiderationDetail({ date, items })
            }
          />
        </div>
      </div>

      {switchFlow && (
        <SwitchFlowBand
          step={switchFlow.step}
          ownCount={switchFlow.ownShiftIds.length}
          targetCount={switchFlow.targetShiftIds.length}
          isSubmitting={
            switchRequestMutation.isPending ||
            generalSwitchRequestMutation.isPending
          }
          warning={switchFlowWarning}
          isCounterOffer={switchFlow.isCounterOffer}
          targetOwnerName={switchFlow.targetOwnerName}
          onCancel={() => {
            if (switchFlowWarningTimeoutRef.current)
              clearTimeout(switchFlowWarningTimeoutRef.current);
            setSwitchFlowWarning(null);
            setSwitchFlow(null);
          }}
          onNext={() => setSwitchFlow((prev) => ({ ...prev, step: "target" }))}
          onSkip={() => {
            if (isViewer || !canTakeShifts) {
              showRoleError();
              return;
            }
            generalSwitchRequestMutation.mutate({
              ownShiftIds: switchFlow.ownShiftIds,
            });
          }}
          onConfirm={() => {
            if (!canTakeShifts) {
              showRoleError();
              return;
            }
            switchRequestMutation.mutate({
              ownShiftIds: switchFlow.ownShiftIds,
              targetShiftIds: switchFlow.targetShiftIds,
            });
          }}
        />
      )}

      {roleError && (
        <div
          className={`fixed inset-x-0 z-[60] ${switchFlow ? "bottom-20" : "bottom-0"}`}
        >
          <div className="bg-red-600 text-white text-center text-sm font-bold py-2 px-4 shadow-lg">
            {roleError}
          </div>
        </div>
      )}

      {/* --- MODALS --- */}

      <AdminSettingsModal isOpen={showAdminSettings} onClose={closeAllModals} />

      <ShiftActionModal
        isOpen={showActionModal}
        onClose={closeAllModals}
        shift={selectedShift}
        date={currentDate}
        onRequestSwap={(type) => {
          closeAllModals();
          setSwapRequestInitialType(type || "full");
          setShowSwapRequestModal(true);
        }}
        onEditRole={() => {
          closeAllModals();
          setShowEditRoleModal(true);
        }}
        onDelete={deleteShiftMutation.mutate}
        isAdmin={isAdmin}
      />

      <SwapRequestModal
        isOpen={showSwapRequestModal}
        onClose={closeAllModals}
        date={currentDate}
        shift={selectedShift}
        onSubmit={handleSwapSubmit}
        isSubmitting={requestSwapMutation.isPending}
        initialSwapType={swapRequestInitialType}
      />

      <AddShiftModal
        isOpen={showAddShiftModal}
        onClose={closeAllModals}
        date={clickedDate || currentDate}
        onSubmit={(data) =>
          addShiftMutation.mutate({
            ...data,
            date: format(currentDate, "yyyy-MM-dd"), // Needs refinement if specific day clicked
          })
        }
        isSubmitting={addShiftMutation.isPending}
      />

      <EditRoleModal
        isOpen={showEditRoleModal}
        onClose={closeAllModals}
        shift={selectedShift}
        date={currentDate}
        onSubmit={(data) =>
          editRoleMutation.mutate({ id: selectedShift.id, ...data })
        }
        isSubmitting={editRoleMutation.isPending}
      />

      <ShiftDetailsModal
        isOpen={showDetailsModal}
        onClose={closeAllModals}
        shift={selectedShift}
        date={currentDate}
        onOfferCover={handleOfferCover}
        onHeadToHead={(shift) => {
          if (!canTakeShifts) {
            showRoleError();
            return;
          }
          setSelectedShift(shift);
          setShowHeadToHeadSelector(true);
        }}
        onCancelRequest={(shift) => {
          if (isViewer) {
            showRoleError();
            return;
          }
          cancelSwapMutation.mutate(shift.id);
        }}
        onCancelCoverage={(shift) => {
          if (isViewer) {
            showRoleError();
            return;
          }
          cancelMyCoverageMutation.mutate(shift);
        }}
        onGift={(shift) => {
          if (!canTakeShifts) {
            showRoleError();
            return;
          }
          giftShiftMutation.mutate(shift);
        }}
        onDelete={deleteShiftMutation.mutate}
        onApprove={() => approveSwapMutation.mutate(selectedShift)}
        onRequestSwap={() => {
          if (!canTakeShifts) {
            showRoleError();
            return;
          }
          closeAllModals();
          setSwapRequestInitialType("full");
          setShowSwapRequestModal(true);
        }}
        onGoToRequest={handleGoToRequest}
        currentUser={tourDemo ? TOUR_DEMO_ME : authorizedPerson}
        canTakeShifts={tourDemo ? true : canTakeShifts}
        isViewer={tourDemo ? false : isViewer}
        demoMode={tourDemo}
        demoOpenGiftConfirm={tourGiftConfirm}
        isAdmin={isAdmin}
      />

      <AcceptSwapModal
        isOpen={showAcceptSwapModal && !!selectedShift}
        onClose={closeAllModals}
        shift={selectedShift}
        existingCoverages={
          selectedShift?.shiftCoverages || selectedShift?.coverages || []
        }
        currentUserId={
          tourDemo ? TOUR_DEMO_ME.serial_id : authorizedPerson?.serial_id
        }
        onAccept={(segmentData) => {
          if (!canTakeShifts) {
            showRoleError();
            return;
          }
          offerCoverMutation.mutate({
            shift: selectedShift,
            coverData: segmentData,
          });
        }}
        isAccepting={offerCoverMutation.isPending}
      />

      <SwapSuccessModal
        isOpen={showSuccessModal}
        onClose={closeAllModals}
        shift={lastUpdatedShift}
        isGeneral={lastSwapWasGeneral}
      />

      <HeadToHeadSelectorModal
        isOpen={showHeadToHeadSelector}
        onClose={closeAllModals}
        targetShift={selectedShift}
        currentUser={tourDemo ? TOUR_DEMO_ME : authorizedPerson}
        canTakeShifts={tourDemo ? true : canTakeShifts}
        onRoleBlocked={showRoleError}
        demoMode={tourDemo}
        demoMyShifts={tourDemo ? buildTourDemoShifts().myShifts : []}
      />

      <HeadToHeadApprovalModal
        isOpen={showHeadToHeadApproval}
        onClose={closeAllModals}
        targetShiftId={h2hTargetId}
        offerShiftId={h2hOfferId}
        onApprove={() => {
          if (!canTakeShifts) {
            showRoleError();
            return;
          }
          headToHeadSwapMutation.mutate();
        }}
        onDecline={closeAllModals}
      />

      <HallOfFameModal isOpen={showHallOfFame} onClose={closeAllModals} />

      <FairnessMatrixModal
        isOpen={showFairnessMatrix}
        onClose={closeAllModals}
        currentUser={authorizedPerson}
        isAdmin={isAdmin}
      />

      {/* Manager-only: which users asked for consideration on a marked date */}
      {considerationDetail && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          dir="rtl"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setConsiderationDetail(null)}
          />
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-lg font-bold text-gray-800 mb-1">אילוצים</h3>
            <p className="text-sm text-gray-500 mb-4">
              לתאריך{" "}
              <span className="font-semibold text-gray-700">
                {String(considerationDetail.date).split("-").reverse().join("/")}
              </span>{" "}
              — משתמשים אלה ביקשו שלא לשבץ אותם במשמרת ביום זה
            </p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {considerationDetail.items.map((it, i) => (
                <div
                  key={`${it.serial_id}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2"
                >
                  <span className="font-semibold text-gray-800 text-sm">
                    {it.name}
                  </span>
                  <span className="text-[11px] font-semibold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">
                    אילוץ
                  </span>
                </div>
              ))}
            </div>
            <button
              onClick={() => setConsiderationDetail(null)}
              className="mt-5 w-full rounded-xl border-2 border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              סגור
            </button>
          </div>
        </div>
      )}

      <HelpSupportModal isOpen={showHelpSupport} onClose={closeAllModals} />

      {showLogoutConfirm && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          dir="rtl"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowLogoutConfirm(false)}
          />
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-title"
            aria-describedby="logout-desc"
          >
            <h3
              id="logout-title"
              className="text-2xl font-bold text-center text-gray-900 mb-2"
            >
              האם אתה בטוח שברצונך להתנתק?
            </h3>
            <p id="logout-desc" className="text-center text-gray-600 text-sm">
              תוכל להתחבר שוב בכל רגע באמצעות פרטי הגישה שלך.
            </p>
            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                className="flex-1 rounded-xl"
                onClick={() => setShowLogoutConfirm(false)}
              >
                לא
              </Button>
              <Button
                className="flex-1 rounded-xl bg-red-500 hover:bg-red-600 text-white"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
              >
                כן
              </Button>
            </div>
          </div>
        </div>
      )}

      <KPIListModal
        key={`${kpiListType}-${kpiOpenSeq}`}
        isOpen={showKPIListModal}
        onClose={closeAllModals}
        type={kpiListType}
        initialTab={kpiInitialTab}
        focusRequestId={kpiFocusRequestId}
        currentUser={authorizedPerson}
        onOfferCover={handleOfferCover}
        onRequestSwap={handleOpenSwapRequest}
        onCancelRequest={(item) => {
          if (isViewer) {
            showRoleError();
            return;
          }
          cancelSwapRequestMutation.mutate(item);
        }}
        onAcceptHeadToHead={(item) => {
          if (!canTakeShifts) {
            showRoleError();
            return;
          }
          acceptHeadToHeadRequestMutation.mutate(item);
        }}
        onAcceptGeneralRequest={(item) => {
          if (!canTakeShifts) {
            showRoleError();
            return;
          }
          acceptGeneralRequestMutation.mutate(item);
        }}
        onAcceptGift={(item) => {
          if (!canTakeShifts) {
            showRoleError();
            return;
          }
          acceptGiftMutation.mutate(item);
        }}
        onStartCounterOffer={(item) => handleStartCounterOffer(item)}
        canTakeShifts={tourDemo ? true : canTakeShifts}
        isViewer={tourDemo ? false : isViewer}
        actionsDisabled={tourDemo}
        demoMode={tourDemo}
      />
    </div>
  );
}
