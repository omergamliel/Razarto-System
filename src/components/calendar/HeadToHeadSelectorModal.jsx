import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Calendar, ArrowLeftRight, Send, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44, logActivity } from "@/api/base44Client";
import {
  buildHeadToHeadDeepLink,
  buildHeadToHeadTemplate,
  normalizeShiftContext,
} from "./whatsappTemplates";

export default function HeadToHeadSelectorModal({
  isOpen,
  onClose,
  targetShift,
  currentUser,
  canTakeShifts,
  onRoleBlocked,
}) {
  const [selectedShift, setSelectedShift] = useState(null);
  // Neither the sonner toast (never mounted anywhere in the app) nor the
  // project's ui/toast (its close button doesn't actually hide the toast —
  // the custom Toast component just spreads `open` as a raw DOM prop instead
  // of conditionally rendering) reliably work here, so this feedback is a
  // plain, self-contained centered dialog instead of a toast.
  const [successPrompt, setSuccessPrompt] = useState(null); // { whatsappUrl } | null
  const [errorMessage, setErrorMessage] = useState("");
  const queryClient = useQueryClient();

  const { data: allShifts = [], isLoading } = useQuery({
    queryKey: ["my-future-shifts-h2h", currentUser?.serial_id],
    queryFn: () => base44.entities.Shift.list(),
    enabled: isOpen && !!currentUser?.serial_id,
  });

  // Ownership + status are derived from ShiftCoverage / SwapRequest now
  // (Phase 4), so enrich each raw shift through the same normalizer the calendar
  // uses before filtering on original_user_id / status below.
  const { data: coverages = [] } = useQuery({
    queryKey: ["coverages"],
    queryFn: () => base44.entities.ShiftCoverage.list(),
    enabled: isOpen,
  });
  const { data: swapRequests = [] } = useQuery({
    queryKey: ["swap-requests"],
    queryFn: () => base44.entities.SwapRequest.list(),
    enabled: isOpen,
  });
  const { data: allUsers = [] } = useQuery({
    queryKey: ["all-users"],
    queryFn: () => base44.entities.AuthorizedPerson.list(),
    enabled: isOpen,
  });

  // Filter Shifts: Only Mine, Future, and eligible statuses (white or full request)
  const myFutureFullShifts = allShifts
    .map((shift) =>
      normalizeShiftContext(shift, {
        allUsers,
        swapRequests,
        coverages,
        currentUser,
      }),
    )
    .filter((shift) => {
      // 1. Is Mine? (Using ID; Number() guards against original_user_id
      // occasionally being stored as a string on some records)
      const isMyShift =
        Number(shift.original_user_id) === Number(currentUser?.serial_id);
      if (!isMyShift) return false;

      // 2. Is Future?
      const shiftDate = new Date(shift.start_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (shiftDate < today) return false;

      const status = String(shift.status || "Active").toLowerCase();
      const requestType = String(
        shift.request_type || shift.coverageType || shift.swap_type || "",
      ).toLowerCase();
      const isPartialRequest =
        requestType === "partial" ||
        status === "partial" ||
        status === "partially_covered";
      const isCovered = status === "covered";
      const isWhiteShift = status === "active" || status === "regular";
      const isRedFullRequest =
        (status === "swap_requested" || status === "requested") &&
        !isPartialRequest;

      // 3. Eligible for head-to-head: white shifts or full request (red), exclude partial and covered
      if (isPartialRequest || isCovered) return false;
      if (!isWhiteShift && !isRedFullRequest) return false;

      return true;
    })
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

  const handleSelectShift = (shift) => {
    setSelectedShift(shift);
  };

  // Builds the WhatsApp share link for this proposal — offered as an
  // optional follow-up action on the success toast, not the primary action.
  const buildWhatsappUrl = () => {
    const approvalLink = buildHeadToHeadDeepLink(
      targetShift.id,
      selectedShift.id,
    );
    const targetDate = format(new Date(targetShift.start_date), "dd/MM", {
      locale: he,
    });
    const offerDate = format(new Date(selectedShift.start_date), "dd/MM", {
      locale: he,
    });
    const targetName = targetShift.user_name || "חבר";

    const message = buildHeadToHeadTemplate({
      targetUserName: targetName,
      targetShiftOwner: targetShift.user_name,
      targetShiftDate: targetDate,
      myShiftOwner: currentUser?.full_name,
      myShiftDate: offerDate,
      // Single shift on each side here, but pass them as lists so the template's
      // {myShifts}/{targetShifts} render (they'd be blank otherwise).
      myShifts: [selectedShift],
      targetShifts: [targetShift],
      uniqueApprovalUrl: approvalLink,
    });

    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  };

  const createH2HRequestMutation = useMutation({
    mutationFn: async () => {
      const req_start_date = selectedShift.start_date;
      const req_end_date = selectedShift.end_date || selectedShift.start_date;
      const req_start_time = selectedShift.start_time || "09:00";
      const req_end_time = selectedShift.end_time || req_start_time;

      await base44.entities.SwapRequest.create({
        shift_ids: [selectedShift.id],
        offered_shift_ids: [targetShift.id],
        requesting_user_id: currentUser.serial_id,
        request_type: "Head2Head",
        req_start_date,
        req_end_date,
        req_start_time,
        req_end_time,
        status: "Open",
      });
      // The shift's swap-requested state is derived from this open Head2Head
      // SwapRequest (Phase 4: Shift.status was removed) — no Shift write needed.
    },
    onSuccess: () => {
      logActivity({
        action: "יצירת בקשת החלפה ראש-בראש",
        type: "בקשות החלפה",
        entity: "SwapRequest",
        entityId: selectedShift?.id,
      });
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      queryClient.invalidateQueries(["my-future-shifts-h2h"]);

      setSuccessPrompt({ whatsappUrl: buildWhatsappUrl() });
      onClose();
    },
    onError: () => {
      setErrorMessage("שליחת בקשת ההחלפה נכשלה. נסו שוב.");
    },
  });

  const handleSendProposal = () => {
    if (!selectedShift) {
      setErrorMessage("נא לבחור משמרת להחלפה");
      return;
    }
    // Sending this proposal is ultimately an attempt to take targetShift in
    // exchange — blocked for anyone who is not the active member of their group
    // (per the ShiftGroup active-member rule, passed in as canTakeShifts;
    // separate from permissions), shown via the shared bottom-of-page banner
    // rather than the inline error here. Defaults to allowed when the prop is
    // absent (e.g. isolated/unit-test rendering).
    if (canTakeShifts === false) {
      onClose();
      onRoleBlocked?.();
      return;
    }
    setErrorMessage("");
    createH2HRequestMutation.mutate();
  };

  if ((!isOpen || !targetShift) && !successPrompt) return null;

  return (
    <AnimatePresence>
      {isOpen && targetShift && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-500 to-purple-600 p-6 text-white">
              <button
                onClick={onClose}
                className="absolute top-4 left-4 p-2 rounded-full hover:bg-white/20 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-3">
                <div className="p-3 bg-white/20 rounded-xl">
                  <ArrowLeftRight className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">החלפה ראש בראש</h2>
                  <p className="text-white/90 text-sm mt-1">
                    בחר איזו משמרת שלך תיתן בתמורה
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4 flex-1 overflow-hidden flex flex-col">
              {/* Target Shift Display */}
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex-shrink-0">
                <p className="text-sm text-purple-700 font-medium mb-2">
                  המשמרת שאתה רוצה לקחת:
                </p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-gray-800">
                      {targetShift.user_name}
                    </p>
                    <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                      <Calendar className="w-4 h-4" />
                      <span>
                        {format(
                          new Date(targetShift.start_date),
                          "EEEE, d בMMMM",
                          { locale: he },
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* My Shifts List */}
              <div className="flex-1 overflow-hidden flex flex-col min-h-0 border-t pt-4">
                <h3 className="font-bold text-gray-700 mb-3 flex-shrink-0">
                  בחר משמרת שלך להחלפה:
                </h3>
                {isLoading ? (
                  <div className="text-center py-8 text-gray-500">
                    טוען משמרות...
                  </div>
                ) : myFutureFullShifts.length === 0 ? (
                  <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                    <p className="text-gray-500 font-medium mb-1">
                      לא נמצאו משמרות מתאימות
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 overflow-y-auto pr-1">
                    {myFutureFullShifts.map((shift) => (
                      <motion.div
                        key={shift.id}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        onClick={() => handleSelectShift(shift)}
                        className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                          selectedShift?.id === shift.id
                            ? "border-purple-500 bg-purple-50 shadow-md ring-1 ring-purple-500"
                            : "border-gray-200 hover:border-purple-300 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <p className="font-bold text-gray-800">
                              המשמרת שלי
                            </p>
                            <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                              <Calendar className="w-3 h-3" />
                              <span>
                                {format(
                                  new Date(shift.start_date),
                                  "d בMMMM (EEEE)",
                                  { locale: he },
                                )}
                              </span>
                            </div>
                          </div>
                          {selectedShift?.id === shift.id && (
                            <div className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center shadow-sm">
                              <Send className="w-3 h-3 text-white ml-0.5" />
                            </div>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 pt-0 flex-shrink-0 bg-white border-t border-gray-100 mt-auto space-y-3">
              {errorMessage && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">
                  {errorMessage}
                </p>
              )}
              <div className="flex gap-3">
                <Button
                  onClick={onClose}
                  variant="outline"
                  className="flex-1 h-12 rounded-xl text-gray-600"
                >
                  ביטול
                </Button>
                <Button
                  onClick={handleSendProposal}
                  disabled={
                    !selectedShift || createH2HRequestMutation.isPending
                  }
                  className={`flex-1 h-12 text-white rounded-xl shadow-md transition-all ${!selectedShift ? "bg-gray-300 cursor-not-allowed" : "bg-gradient-to-r from-purple-500 to-purple-600"}`}
                >
                  <span className="flex items-center gap-2">
                    {createH2HRequestMutation.isPending
                      ? "שולח..."
                      : "שלח בקשת החלפה"}{" "}
                    <Send className="w-4 h-4" />
                  </span>
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {successPrompt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSuccessPrompt(null)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4"
          >
            <button
              onClick={() => setSuccessPrompt(null)}
              className="absolute top-4 left-4 p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-500"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-green-600" />
            </div>
            <p className="font-bold text-lg text-gray-800">
              בקשת ההחלפה נשלחה בהצלחה!
            </p>
            <p className="text-sm text-gray-500">
              אפשר גם לשתף את ההצעה בוואטסאפ
            </p>
            <div className="flex gap-3">
              <Button
                onClick={() => setSuccessPrompt(null)}
                variant="outline"
                className="flex-1 h-11 rounded-xl"
              >
                סגור
              </Button>
              <Button
                onClick={() => {
                  window.open(successPrompt.whatsappUrl, "_blank");
                  setSuccessPrompt(null);
                }}
                className="flex-1 h-11 rounded-xl bg-[#25D366] hover:bg-[#128C7E] text-white"
              >
                שלח בוואטסאפ
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
