import React from "react";
import { Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LogIn, ShieldCheck, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { useAuthorizedPerson } from "@/hooks/useAuthorizedPerson";
import UserNotRegisteredError from "@/components/UserNotRegisteredError";

const FullScreenLoader = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

export default function Login() {
  const {
    isAuthenticated,
    isLoadingAuth,
    user,
    navigateToLogin,
    checkAppState,
  } = useAuth();
  const { isChecking, isAuthorized } = useAuthorizedPerson(user?.email);

  // Wait for auth + whitelist check before deciding anything.
  if (isLoadingAuth || (isAuthenticated && isChecking)) {
    return <FullScreenLoader />;
  }

  // Already authenticated AND authorized → straight into the app.
  if (isAuthenticated && isAuthorized) {
    return <Navigate to="/" replace />;
  }

  // Authenticated on the platform but NOT in the AuthorizedPerson whitelist.
  // Show the existing "not authorized" screen (contact support + re-check).
  if (isAuthenticated && !isAuthorized) {
    return <UserNotRegisteredError onRefresh={checkAppState} />;
  }

  // Not authenticated → login landing. The button hands off to the
  // platform's hosted login (base44.auth.redirectToLogin); we never handle
  // credentials ourselves.
  return (
    <div
      className="min-h-screen bg-[#F9FAFB] flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden"
      dir="rtl"
    >
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-blue-50 rounded-full blur-3xl opacity-60"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-96 h-96 bg-indigo-50 rounded-full blur-3xl opacity-60"></div>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 sm:p-8 text-center border border-gray-100"
      >
        <div className="flex justify-center mb-6">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="w-20 h-20 sm:w-24 sm:h-24 bg-blue-50 rounded-full flex items-center justify-center"
          >
            <CalendarClock className="w-10 h-10 sm:w-12 sm:h-12 text-blue-500" />
          </motion.div>
        </div>

        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
          ברוכים הבאים ל-Razarto
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          מערכת לניהול משמרות וביצוע החלפות מסודרות
        </p>

        <Button
          onClick={navigateToLogin}
          className="w-full h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl shadow-lg shadow-blue-100 transition-all flex items-center justify-center gap-3 text-base font-bold transform hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:ring-offset-white"
        >
          <LogIn className="w-6 h-6" />
          התחברות
        </Button>

        <div className="mt-6 pt-5 border-t border-gray-50 flex items-center justify-center gap-2 text-xs text-gray-400">
          <ShieldCheck className="w-4 h-4" />
          <span>הכניסה למערכת מוגבלת למשתמשים מורשים בלבד</span>
        </div>
      </motion.div>
    </div>
  );
}