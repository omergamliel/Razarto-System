import React from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, RefreshCw, MessageCircle, Lock, AlertTriangle } from 'lucide-react';
import { Button } from "@/components/ui/button";

const UserNotRegisteredError = ({
  onRefresh,
  title = "הגישה נדחתה",
  message = "המשתמש שלך אינו מופיע ברשימת המורשים לכניסה למערכת. ייתכן שטרם הוגדרת על ידי מנהל המערכת.",
}) => {
  
  const handleContactSupport = () => {
    const phoneNumber = "972546881831";
    const message = "היי, אני מנסה להתחבר למערכת Razarto ומופיעה לי שגיאת הרשאות. אשמח לעזרה בהוספת ההרשאה המתאימה.";
    const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden" dir="rtl">
      
      {/* Background Decorations */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-red-50 rounded-full blur-3xl opacity-60"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-96 h-96 bg-orange-50 rounded-full blur-3xl opacity-60"></div>
      </div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 sm:p-8 text-center border border-gray-100"
      >
        {/* Status Icon */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="w-20 h-20 sm:w-24 sm:h-24 bg-red-50 rounded-full flex items-center justify-center"
            >
              <ShieldAlert className="w-10 h-10 sm:w-12 sm:h-12 text-red-500" />
            </motion.div>
            <motion.div 
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.4 }}
              className="absolute -bottom-2 -right-2 w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-md border border-gray-100"
            >
              <Lock className="w-5 h-5 text-gray-400" />
            </motion.div>
          </div>
        </div>

        {/* Main Text */}
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3">
          {title}
        </h1>

        <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 mb-6 text-right">
          <div className="flex gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-gray-800">
                לא זוהו הרשאות מתאימות
              </p>
              <p className="text-sm text-gray-600 leading-relaxed">
                {message}
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3">
          <Button
            onClick={handleContactSupport}
            aria-label="פנייה לקבלת הרשאה דרך ווטסאפ"
            className="w-full h-14 bg-[#25D366] hover:bg-[#128C7E] text-white rounded-2xl shadow-lg shadow-green-100 transition-all flex items-center justify-center gap-3 text-base font-bold transform hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-white"
          >
            <MessageCircle className="w-6 h-6" />
            פנייה בקבלת הרשאה
          </Button>

          <Button 
            onClick={onRefresh}
            variant="outline"
            className="w-full h-14 border-2 border-gray-100 text-gray-600 hover:bg-gray-50 hover:text-gray-900 hover:border-gray-200 rounded-2xl flex items-center justify-center gap-3 text-base font-medium transition-all"
          >
            <RefreshCw className="w-5 h-5" />
            רענון ובדיקה חוזרת
          </Button>
        </div>

        {/* Footer Info */}
        <div className="mt-8 pt-6 border-t border-gray-50 flex justify-between items-center text-xs text-gray-400 font-mono">
          <span>Error: 403_AUTH_MISSING</span>
          <span>Razarto Security</span>
        </div>

      </motion.div>
    </div>
  );
};

export default UserNotRegisteredError;

