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
} from "lucide-react";
import {
  subscribe,
  getMessages,
  removeMessage,
  clearAll,
  dispatchAction,
} from "./messageStore";
import { useScrollLock } from "@/hooks/useScrollLock";

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

export default function NotificationSidebar() {
  const [messages, setMessages] = useState(getMessages());
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => subscribe(setMessages), []);

  // Lock background scrolling while the sidebar panel is open.
  useScrollLock(isOpen);

  const count = messages.length;

  return (
    <>
      {/* Toggle tab — fixed to the right edge, always visible */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        aria-label={isOpen ? "סגירת הודעות" : "פתיחת הודעות"}
        className="fixed bottom-5 right-5 z-40 flex items-center justify-center h-12 w-12 rounded-full bg-black hover:bg-gray-800 shadow-lg transition-colors"
        dir="rtl"
      >
        <MessageSquare className="w-6 h-6 text-white" />
        {count > 0 && (
          <span className="absolute top-1 right-1 w-3 h-3 rounded-full bg-blue-500 border-2 border-black" />
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
              className="fixed top-0 right-0 z-50 h-full w-[88vw] max-w-[380px] bg-white shadow-2xl border-l border-gray-200 flex flex-col"
              dir="rtl"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-gray-700" />
                  <h2 className="text-base font-bold text-gray-800">הודעות</h2>
                  {count > 0 && (
                    <span className="text-xs font-medium text-gray-500">({count})</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {count > 0 && (
                    <button
                      onClick={clearAll}
                      className="text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded-md hover:bg-red-50 transition-colors"
                    >
                      נקה הכל
                    </button>
                  )}
                  <button
                    onClick={() => setIsOpen(false)}
                    aria-label="סגירה"
                    className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 transition-colors"
                  >
                    <X className="w-5 h-5" />
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
                    <p className="text-sm font-medium text-gray-500">אין הודעות כרגע</p>
                    <p className="text-xs text-gray-400 mt-1 max-w-[220px]">
                      הודעות על משמרות, בקשות החלפה ופערי כיסוי יופיעו כאן.
                    </p>
                  </div>
                ) : (
                  messages.map((msg) => {
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
                              <span className={`text-[10px] font-bold uppercase tracking-wide ${style.text}`}>
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