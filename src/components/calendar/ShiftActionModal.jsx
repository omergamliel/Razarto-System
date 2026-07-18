import React, { useState } from 'react';
import { format, addDays } from 'date-fns';
import { he } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, ShieldAlert, Calendar, Clock } from 'lucide-react';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ShiftActionModal({ 
  isOpen, 
  onClose, 
  shift, 
  date, 
  onRequestSwap, 
  onEditRole, 
  onDelete,
  isAdmin 
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = () => {
    onDelete(shift.id);
    setShowDeleteConfirm(false);
    onClose();
  };

  if (!isOpen || !shift) return null;

  // --- תיקון לוגיקת תאריכים ---
  // אם יש תאריכים מה-DB נשתמש בהם, אחרת נחשב לפי השעות
  const startTime = shift.start_time || '09:00';
  const endTime = shift.end_time || '09:00';
  
  const startDateObj = shift.start_date ? new Date(shift.start_date) : new Date(date);
  
  // חישוב חכם לתאריך סיום: אם אין תאריך סיום ב-DB, והשעה של הסיום קטנה/שווה להתחלה -> סימן שזה יום למחרת
  let endDateObj;
  if (shift.end_date) {
      endDateObj = new Date(shift.end_date);
  } else {
      const sH = parseInt(startTime.split(':')[0]);
      const eH = parseInt(endTime.split(':')[0]);
      // אם שעת סיום קטנה משעת התחלה, או שזה 09:00-09:00 (24 שעות) -> זה יום למחרת
      if (eH < sH || (sH === 9 && eH === 9)) {
          endDateObj = addDays(startDateObj, 1);
      } else {
          endDateObj = startDateObj;
      }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col font-sans"
            >
              {/* Header */}
              <div className="bg-[#EF5350] p-5 text-white flex justify-between items-center shrink-0">
                 <div className="flex items-center gap-3">
                    <div className="bg-white/20 p-2.5 rounded-xl backdrop-blur-sm shadow-inner">
                        <Calendar className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold tracking-wide">פעולות על המשמרת</h2>
                    </div>
                 </div>
                 <button onClick={onClose} className="p-2 rounded-full hover:bg-white/20 transition-colors">
                    <X className="w-5 h-5" />
                 </button>
              </div>

              {/* Body Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">

                {/* Assignment Info */}
                <div className="text-center space-y-3">
                    <p className="text-sm text-gray-500 font-medium">משובץ כרגע למשמרת</p>
                    <h3 className="text-2xl font-semibold text-gray-900 leading-none">
                        {shift.user_name || shift.role}
                    </h3>
                    {shift.department && (
                        <span className="inline-flex items-center justify-center rounded-full bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700 border border-gray-200">
                        {`מחלקה ${shift.department}`}
                        </span>
                    )}
                </div>

                {/* Times Display (Start -> End) */}
                <div className="flex items-center justify-between bg-gray-50 rounded-2xl p-1 border border-gray-100 shadow-sm">
                    {/* Start */}
                    <div className="flex-1 text-center py-3">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                            {format(startDateObj, 'EEEE', { locale: he })}
                        </p>
                        <p className="text-xl font-bold text-gray-800 leading-none mb-1 font-mono">{startTime}</p>
                        <p className="text-[11px] text-gray-400">{format(startDateObj, 'dd/MM/yyyy')}</p>
                    </div>

                    {/* Divider */}
                    <div className="flex flex-col items-center justify-center px-2 text-gray-400">
                        <Clock className="w-5 h-5" />
                    </div>

                    {/* End */}
                    <div className="flex-1 text-center py-3">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                            {format(endDateObj, 'EEEE', { locale: he })}
                        </p>
                        <p className="text-xl font-bold text-gray-800 leading-none mb-1 font-mono">{endTime}</p>
                        <p className="text-[11px] text-gray-400">{format(endDateObj, 'dd/MM/yyyy')}</p>
                    </div>
                </div>

                {/* Buttons */}
                <div className="flex flex-col gap-3 pt-2">
                   <div className="flex flex-col sm:flex-row gap-3">
                      <Button
                         onClick={() => onRequestSwap('full')}
                         className="flex-1 h-12 bg-gradient-to-r from-[#EF5350] to-[#E53935] hover:from-[#E53935] hover:to-[#D32F2F] text-white rounded-xl shadow-lg shadow-red-500/20 text-base font-bold"
                       >
                         בקשת החלפה מלאה
                      </Button>

                      <Button
                         onClick={() => onRequestSwap('partial')}
                         variant="outline"
                         className="flex-1 h-12 rounded-xl border-2 border-[#EF5350] text-[#EF5350] hover:bg-red-50 text-base font-bold"
                       >
                         בקשת החלפה חלקית
                      </Button>
                   </div>

                   <Button
                      onClick={onClose}
                      variant="ghost"
                      className="w-full h-12 rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 text-base font-medium"
                    >
                      ביטול
                   </Button>
                </div>

                {/* Admin Actions */}
                {isAdmin && (
                  <div className="pt-4 border-t border-gray-100">
                    <div className="flex gap-2 w-full">
                        <Button
                            variant="ghost"
                            onClick={onEditRole}
                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 text-xs flex-1"
                        >
                            ערוך שיבוץ
                        </Button>
                        <Button
                            variant="ghost"
                            onClick={() => setShowDeleteConfirm(true)}
                            className="text-red-400 hover:text-red-500 hover:bg-red-50 text-xs flex-1"
                        >
                            <Trash2 className="w-3 h-3 mr-1" />
                            מחק משמרת
                        </Button>
                    </div>
                  </div>
                )}

              </div>
            </motion.div>
          </div>

          {/* Delete Confirmation Dialog */}
          <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <DialogContent dir="rtl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-red-600">
                    <ShieldAlert className="w-5 h-5" />
                    מחיקת משמרת
                </DialogTitle>
                <DialogDescription>
                  האם אתה בטוח שברצונך למחוק את המשמרת של <b>{shift.user_name || shift.role}</b>?
                  <br/>
                  פעולה זו אינה הפיכה.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>ביטול</Button>
                <Button variant="destructive" onClick={handleDelete}>כן, מחק משמרת</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </AnimatePresence>
  );
}