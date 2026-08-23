import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, Share2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { buildShiftDeepLink, buildSwapTemplate, buildGeneralTemplate } from './whatsappTemplates';

// `isGeneral` = the request is a whole-shift (General) swap, broadcast to the
// whole team; those share the "general" template, while a partial-window swap
// shares the "swap" (partial-coverage) template.
export default function SwapSuccessModal({ isOpen, onClose, shift, isGeneral = false }) {
  if (!isOpen || !shift) return null;

  const handleWhatsAppShare = () => {
    // Fixed: Changed to Query Param for deep linking to home page
    const approvalUrl = buildShiftDeepLink(shift.id);
    const ownerName = shift.original_user_data?.full_name || shift.original_user_name || shift.user_name || shift.role;
    const shared = {
      startDate: shift.start_date || shift.date,
      startTime: shift.swap_start_time || shift.start_time || '09:00',
      endDate: shift.end_date || shift.start_date,
      endTime: shift.swap_end_time || shift.end_time || shift.start_time || '09:00',
      approvalUrl,
    };
    const message = isGeneral
      ? buildGeneralTemplate({ originalOwnerName: ownerName, ...shared })
      : buildSwapTemplate({ originalOwnerName: ownerName, ...shared });
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden text-center p-6"
        >
          <button 
            onClick={onClose} 
            className="absolute top-4 left-4 p-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>

          <div className="mx-auto w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>

          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            הבקשה פורסמה!
          </h2>
          
          <p className="text-gray-600 text-sm mb-6 leading-relaxed">
            המשמרת מופיעה כעת בלוח כ"דרוש החלפה".
            <br />
            <span className="font-medium text-gray-800">למציאת מחליף מהר יותר:</span>
          </p>

          <div className="space-y-3">
            <Button
              onClick={handleWhatsAppShare}
              className="w-full h-12 text-lg bg-[#25D366] hover:bg-[#128C7E] text-white rounded-xl shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
            >
              <Share2 className="w-5 h-5" />
              שתף בקבוצה בוואטסאפ
            </Button>

            <Button
              onClick={onClose}
              variant="ghost"
              className="w-full text-gray-400 hover:text-gray-600 font-normal hover:bg-transparent"
            >
              סגור
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}