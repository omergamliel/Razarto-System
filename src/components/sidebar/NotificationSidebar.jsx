import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  MessageSquare,
  X,
  ChevronRight,
  ArrowLeftRight,
  AlertCircle,
  CheckCircle2,
  Clock,
  Calendar,
  Gift,
} from "lucide-react";
import {
  subscribe,
  getMessages,
  removeMessage,
  clearAll,
  dispatchAction,
} from "./messageStore";
import { useScrollLock } from "@/hooks/useScrollLock";
import { useNotificationScanner } from "@/hooks/useNotificationScanner";

// Visual codes mirror the shift-status styles in ShiftCell.jsx so a
// notification matches the look of the shift it refers to.
const TYPE_STYLES = {
  swap_requested: {
    label: "בקשת החלפה",
    bg: "bg-red-50",
    border: "border-red-300",
    badge: "bg-red-500",
    text: "text-red-700",
    icon: ArrowLeftRight,
  },
  partial: {
    label: "פער כיסוי",
    bg: "bg-yellow-50",
    border: "border-yellow-300",
    badge: "bg-yellow-500",
    text: "text-yellow-700",
    icon: AlertCircle,
  },
  covered: {
    label: "מכוסה",
    bg: "bg-green-50",
    border: "border-green-300",
    badge: "bg-green-500",
    text: "text-green-700",
    icon: CheckCircle2,
  },
  mine: {
    label: "המשמרת שלי",
    bg: "bg-blue-50",
    border: "border-blue-300",
    badge: "bg-blue-500",
    text: "text-blue-700",
    icon: Clock,
  },
  holiday: {
    label: "חג / מועד",
    bg: "bg-purple-50",
    border: "border-purple-300",
    badge: "bg-purple-500",
    text: "text-purple-700",
    icon: Calendar,
  },
  gift: {
    label: "מתנה",
    bg: "bg-pink-50",
    border: "border-pink-300",
    badge: "bg-pink-500",
    text: "text-pink-700",
    icon: Gift,
  },
  info: {
    label: "הודעה",
    bg: "bg-gray-50",
    border: "border-gray-300",
    badge: "bg-gray-500",
    text: "text-gray-700",
    icon: Bell,
  },
};

const getStyle = (type) => TYPE_STYLES[type] || TYPE_STYLES.info;

// Example notifications shown only while the guided walkthrough spotlights this
// panel (razarto:tour-notif with demo:true). They cover every notification
// type/color so the tour can explain them on a populated panel instead of the
// account's real (often empty) feed. Read-only; the remove/clear buttons and
// action buttons are hidden in demo mode so nothing is touched.
const DEMO_MESSAGES = [
  {
    id: "demo-notif-h2h",
    type: "swap_requested",
    title: "בקשת החלפה ראש בראש חדשה",
    body: "שמואל כהן הציע לך החלפה ראש בראש. אפשר לאשר או לדחות מתוך 'בקשות אליי'.",
    actionLabel: "צפייה בבקשה",
    actionTarget: "kpi:swap_requests:incoming",
  },
  {
    id: "demo-notif-gift",
    type: "gift",
    title: "הוצעה לך מתנה 🎁",
    body: "נועה ביטון מציעה לקחת על עצמה את המשמרת שלך במתנה — אשרו כדי להשתחרר מהמשמרת.",
    actionLabel: "צפייה בהצעה",
    actionTarget: "kpi:swap_requests:incoming",
  },
  {
    id: "demo-notif-partial",
    type: "partial",
    title: "הוצע כיסוי למשמרת שלך",
    body: "יעל ישראלי הציעה לכסות חלק מהשעות במשמרת שלך.",
    actionLabel: "צפייה בבקשה",
    actionTarget: "kpi:partial_gaps:mine",
  },
  {
    id: "demo-notif-covered",
    type: "covered",
    title: "המשמרת שלך כוסתה",
    body: "אבי פרץ כיסה את המשמרת שלך — אין צורך להגיע.",
    actionLabel: "צפייה בבקשה",
    actionTarget: "kpi:swap_requests:mine",
  },
  {
    id: "demo-notif-pending",
    type: "info",
    title: "הבקשה שלך עדיין ממתינה",
    body: "בקשת ההחלפה שפתחת עדיין לא התקבלה על ידי אף אחד.",
    actionLabel: "צפייה בבקשה",
    actionTarget: "kpi:swap_requests:mine",
  },
];

export default function NotificationSidebar() {
  // Populates messageStore by scanning current entity data on load/refetch —
  // this is the only thing in the app that ever calls addMessage().
  useNotificationScanner();

  const [messages, setMessages] = useState(getMessages());
  const [isOpen, setIsOpen] = useState(false);
  // Set by the walkthrough: render the demo notifications above instead of the
  // real feed while the tour spotlights this panel.
  const [tourDemo, setTourDemo] = useState(false);

  useEffect(() => subscribe(setMessages), []);

  // Let the guided walkthrough (AppTour in Home.jsx) open/close this panel so
  // it can spotlight it. UI-only — toggles the same isOpen state a click would,
  // reads no real data and writes nothing.
  useEffect(() => {
    const handler = (e) => {
      setIsOpen(!!e.detail?.open);
      setTourDemo(!!e.detail?.demo);
    };
    window.addEventListener("razarto:tour-notif", handler);
    return () => window.removeEventListener("razarto:tour-notif", handler);
  }, []);

  // Lock background scrolling while the sidebar panel is open.
  useScrollLock(isOpen);

  const displayMessages = tourDemo ? DEMO_MESSAGES : messages;
  const count = displayMessages.length;

  return (
    <>
      {/* Toggle tab — fixed to the right edge, always visible */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        aria-label={isOpen ? "סגירת הודעות" : "פתיחת הודעות"}
        data-tour="notif-button"
        className="fixed bottom-5 right-5 z-40 flex items-center justify-center h-[3.375rem] w-[3.375rem] rounded-full bg-black hover:bg-gray-800 shadow-lg transition-colors"
        dir="rtl"
      >
        <MessageSquare className="w-7 h-7 text-white" />
        {count > 0 && (
          <span className="absolute top-0.5 left-0.5 min-w-[1.375rem] h-[1.375rem] px-1 flex items-center justify-center rounded-full bg-blue-500 border-2 border-black text-white text-xs font-bold leading-none">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop (mobile) */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-40 bg-black/20 md:hidden"
            />

            {/* Panel — slides in from the right */}
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              data-tour="notif-panel"
              className="fixed top-0 right-0 z-50 h-full w-[88vw] max-w-[380px] bg-white shadow-2xl border-l border-gray-200 flex flex-col"
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2 min-w-0">
                  <Bell className="w-5 h-5 text-gray-700 shrink-0" />
                  <h2 className="text-base font-bold text-gray-800 truncate">
                    הודעות
                  </h2>
                  {count > 0 && (
                    <span className="text-xs font-medium text-gray-500 shrink-0">
                      ({count})
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {count > 0 && (
                    <button
                      onClick={clearAll}
                      className="shrink-0 whitespace-nowrap text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded-md hover:bg-red-50 transition-colors"
                    >
                      נקה הכל
                    </button>
                  )}
                  <button
                    onClick={() => setIsOpen(false)}
                    aria-label="סגירה"
                    className="shrink-0 grow-0 basis-11 flex items-center justify-center w-11 h-11 -mr-1 rounded-lg text-gray-500 hover:bg-gray-200 active:bg-gray-300 transition-colors"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {count === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12">
                    <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                      <Bell className="w-7 h-7 text-gray-300" />
                    </div>
                    <p className="text-sm font-medium text-gray-500">
                      אין הודעות כרגע
                    </p>
                    <p className="text-xs text-gray-400 mt-1 max-w-[220px]">
                      הודעות על משמרות, בקשות החלפה ופערי כיסוי יופיעו כאן.
                    </p>
                  </div>
                ) : (
                  displayMessages.map((msg) => {
                    const style = getStyle(msg.type);
                    const Icon = style.icon;
                    return (
                      <motion.div
                        key={msg.id}
                        layout
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: 40 }}
                        className={`rounded-xl border ${style.bg} ${style.border} p-3 shadow-sm`}
                      >
                        <div className="flex items-start gap-2.5">
                          <div
                            className={`shrink-0 w-8 h-8 rounded-lg ${style.badge} text-white flex items-center justify-center`}
                          >
                            <Icon className="w-4 h-4" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`text-[10px] font-bold uppercase tracking-wide ${style.text}`}
                              >
                                {style.label}
                              </span>
                              <button
                                onClick={() => removeMessage(msg.id)}
                                aria-label="הסר הודעה"
                                className="text-gray-400 hover:text-gray-700 transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {msg.title && (
                              <p className="text-sm font-semibold text-gray-800 mt-0.5 break-words">
                                {msg.title}
                              </p>
                            )}
                            {msg.body && (
                              <p className="text-xs text-gray-600 mt-1 break-words leading-relaxed">
                                {msg.body}
                              </p>
                            )}

                            {msg.actionTarget && msg.actionLabel && (
                              <button
                                onClick={() => {
                                  dispatchAction(msg.actionTarget);
                                  setIsOpen(false);
                                }}
                                className={`mt-2.5 inline-flex items-center gap-1 text-xs font-semibold ${style.text} bg-white/70 hover:bg-white border ${style.border} rounded-lg px-2.5 py-1.5 transition-colors`}
                              >
                                {msg.actionLabel}
                                <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                              </button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
