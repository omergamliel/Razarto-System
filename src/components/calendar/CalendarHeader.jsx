import React, { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  ChevronLeft,
  Calendar,
  List,
  Settings,
  Upload,
  Info,
  Trophy,
  HelpCircle,
  Scale,
} from "lucide-react";
import { format, addMonths, subMonths, addWeeks, subWeeks } from "date-fns";
import { he } from "date-fns/locale";
import { motion } from "framer-motion";
import { base44, logActivity } from "@/api/base44Client";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSystemSettings } from "@/hooks/useAuthorizedPerson";

export default function CalendarHeader({
  currentDate,
  setCurrentDate,
  viewMode,
  setViewMode,
  isAdmin,
  onOpenAdminSettings,
  onOpenHallOfFame,
  onOpenFairnessMatrix,
  onOpenHelp,
  onLogout,
  currentUser,
  hideHeader = false,
  hideNavigation = false,
}) {
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();

  // --- פונקציה לברכה דינמית לפי שעה ---
  const getTimeBasedGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "בוקר טוב";
    if (hour >= 12 && hour < 18) return "צהריים טובים";
    if (hour >= 18 && hour < 22) return "ערב טוב";
    return "לילה טוב";
  };

  // --- לוגיקה של לוגו ---
  const { data: appSettings = [] } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => base44.entities.AppSettings.list(),
  });

  // Admin-configurable brand title / subtitle (ניהול מערכת ▸ הגדרות). Fall
  // back to the built-in copy when nothing has been saved so the header is
  // never blank.
  const systemSettings = useSystemSettings();
  const brandTitle = systemSettings.title?.trim() || "מערכת לניהול משמרות";
  const brandSubtitle =
    systemSettings.subtitle?.trim() || "צפייה במשמרות | ביצוע החלפות מסודרות";

  const logoUrl =
    appSettings.find((s) => s.setting_key === "logo")?.logo_url || "";

  const updateLogoMutation = useMutation({
    mutationFn: async (url) => {
      const existing = appSettings.find((s) => s.setting_key === "logo");
      if (existing) {
        return base44.entities.AppSettings.update(existing.id, {
          logo_url: url,
        });
      } else {
        return base44.entities.AppSettings.create({
          setting_key: "logo",
          logo_url: url,
        });
      }
    },
    onSuccess: () => {
      logActivity({
        action: "עדכון לוגו המערכת",
        type: "עדכון מערכת",
        entity: "AppSettings",
      });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    },
  });

  // --- ניווט בתאריכים ---
  const navigatePrev = () => {
    if (viewMode === "month") {
      setCurrentDate(subMonths(currentDate, 1));
    } else {
      setCurrentDate(subWeeks(currentDate, 1));
    }
  };

  const navigateNext = () => {
    if (viewMode === "month") {
      setCurrentDate(addMonths(currentDate, 1));
    } else {
      setCurrentDate(addWeeks(currentDate, 1));
    }
  };

  const formatTitle = () => {
    if (viewMode === "month") {
      return format(currentDate, "MMMM yyyy", { locale: he });
    } else {
      return `שבוע ${format(currentDate, "w", { locale: he })} - ${format(currentDate, "MMMM yyyy", { locale: he })}`;
    }
  };

  const handleLogoClick = () => {
    if (isAdmin) {
      fileInputRef.current?.click();
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      updateLogoMutation.mutate(file_url);
      toast.success("הלוגו עודכן בהצלחה");
    } catch (error) {
      toast.error("שגיאה בהעלאת הלוגו");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative z-50 ${hideNavigation || hideHeader ? "mb-2" : "mb-6"}`}
    >
      {!hideHeader && (
        <>
          {/* ----------------------------- */}
          {/* 1. פס עליון סטיקי (User + Logo + Icons) */}
          {/* ----------------------------- */}
          <div className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-200 shadow-sm px-4 md:px-6 py-3 rounded-b-2xl -mx-4 -mt-6 mb-4 flex items-center justify-between transition-all">
            {/* צד ימין: לוגו + ברכה + שם משתמש */}
            <div className="flex items-center gap-3 md:gap-4 flex-shrink-0">
              {/* LOGO AREA - Compact for Mobile */}
              <div className="relative group">
                {isAdmin && (
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                )}
                <div
                  onClick={isAdmin ? handleLogoClick : undefined}
                  className={`w-10 h-10 md:w-12 md:h-12 bg-gradient-to-br from-[#E57373] to-[#EF5350] rounded-full shadow-md flex items-center justify-center overflow-hidden relative flex-shrink-0 ${isAdmin ? "cursor-pointer hover:scale-105 transition-transform" : ""}`}
                >
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt="לוגו"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-white font-bold text-[10px] md:text-xs">
                      לוגו
                    </span>
                  )}

                  {isAdmin && (
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Upload className="w-4 h-4 text-white" />
                    </div>
                  )}
                </div>
              </div>

              {/* TEXT AREA */}
              <div
                className="flex flex-col items-start justify-center"
                data-tour="user-greeting"
              >
                <span className="text-gray-500 text-[10px] md:text-xs font-medium leading-none mb-0.5">
                  {getTimeBasedGreeting()},
                </span>
                <span className="text-gray-900 font-bold text-base md:text-lg leading-tight truncate max-w-[140px] md:max-w-none">
                  {currentUser?.assigned_role ||
                    currentUser?.full_name ||
                    "אורח"}
                </span>
              </div>
            </div>

            {/* צד שמאל: שורת האייקונים */}
            <div className="flex items-center gap-1 md:gap-3">
              {/* 1. היכל התהילה */}
              <button
                onClick={onOpenHallOfFame}
                data-tour="hall-of-fame"
                className="group relative p-2 rounded-xl hover:bg-gray-100 transition-all duration-200"
                title="היכל התהילה"
              >
                <img
                  src="https://cdn-icons-png.flaticon.com/128/1021/1021202.png"
                  alt="Hall of Fame"
                  className="w-6 h-6 md:w-7 md:h-7 object-contain group-hover:scale-110 transition-transform"
                />
              </button>

              {/* 1b. טבלת צדק */}
              <button
                onClick={onOpenFairnessMatrix}
                data-tour="fairness"
                className="group relative p-2 rounded-xl hover:bg-gray-100 transition-all duration-200"
                title="טבלת צדק"
              >
                <Scale className="w-6 h-6 md:w-7 md:h-7 text-[#3F51B5] group-hover:scale-110 transition-transform" />
              </button>

              {/* 2. תמיכה ועזרה */}
              <button
                onClick={onOpenHelp}
                data-tour="help"
                className="group relative p-2 rounded-xl hover:bg-gray-100 transition-all duration-200"
                title="תמיכה ועזרה"
              >
                <HelpCircle className="w-6 h-6 md:w-7 md:h-7 text-[#00897B] group-hover:scale-110 transition-transform" />
              </button>

              {/* 3. לוח ניהול (רק למנהלים) */}
              {isAdmin && (
                <button
                  onClick={onOpenAdminSettings}
                  className="group relative p-2 rounded-xl hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all duration-200"
                  title="לוח ניהול"
                >
                  <img
                    src="https://cdn-icons-png.flaticon.com/128/2965/2965279.png"
                    alt="Admin Panel"
                    className="w-6 h-6 md:w-7 md:h-7 object-contain group-hover:scale-110 transition-transform"
                  />
                </button>
              )}

              {/* 4. התנתקות */}
              <button
                onClick={onLogout}
                className="group relative p-2 rounded-xl hover:bg-red-50 transition-all duration-200"
                title="התנתקות"
              >
                <img
                  src="https://cdn-icons-png.flaticon.com/128/5509/5509597.png"
                  alt="Logout"
                  className="w-6 h-6 md:w-7 md:h-7 object-contain group-hover:scale-110 transition-transform"
                />
              </button>
            </div>
          </div>

          {/* ----------------------------- */}
          {/* 2. אזור המיתוג (כותרת ראשית בלבד - לוגו הועבר למעלה) */}
          {/* ----------------------------- */}
          <div
            className="flex flex-col items-center justify-center mb-1 px-2 text-center"
            data-tour="brand"
          >
            <h1
              className="text-3xl md:text-5xl font-extrabold text-gray-800 tracking-wider mb-0.5"
              style={{ letterSpacing: "0.1em" }}
            >
              Razarto
            </h1>
            <div className="flex flex-col items-center gap-0.5">
              <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-xs md:text-sm font-medium">
                {brandTitle}
              </span>
              <p className="text-gray-400 text-[10px] md:text-xs">
                {brandSubtitle}
              </p>
            </div>
          </div>
        </>
      )}

      {/* ----------------------------- */}
      {/* 3. סרגל ניווט תחתון (ממורכז) */}
      {/* ----------------------------- */}
      {!hideNavigation && (
        <div
          className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-gray-100 p-3 md:p-4"
          data-tour="calendar-nav"
        >
          {/* שיניתי את הסדר כאן כדי למרכז */}
          <div className="flex flex-col md:flex-row-reverse items-center justify-between gap-3 md:gap-4">
            {/* כפתורי תצוגה (ימין ב-RTL, שמאל במסך) */}
            <div className="flex items-center bg-gray-100 rounded-xl p-1 order-2 md:order-1 w-full md:w-auto justify-center">
              <button
                onClick={() => setViewMode("month")}
                className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  viewMode === "month"
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <Calendar className="w-4 h-4" />
                חודשי
              </button>
              <button
                onClick={() => setViewMode("week")}
                className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  viewMode === "week"
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <List className="w-4 h-4" />
                שבועי
              </button>
            </div>

            {/* חיצים וכותרת תאריך (מרכז) */}
            <div className="flex items-center gap-2 md:gap-4 flex-1 justify-center order-1 md:order-2 w-full md:w-auto">
              <Button
                variant="ghost"
                size="icon"
                onClick={navigatePrev}
                className="rounded-xl hover:bg-gray-100"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>

              <h2 className="text-lg md:text-xl font-semibold text-gray-800 min-w-[150px] md:min-w-[200px] text-center">
                {formatTitle()}
              </h2>

              <Button
                variant="ghost"
                size="icon"
                onClick={navigateNext}
                className="rounded-xl hover:bg-gray-100"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
            </div>

            {/* אלמנט דמי לאיזון (שמאל ב-RTL) - מוסתר במובייל */}
            <div className="hidden md:block w-[180px] order-3"></div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
