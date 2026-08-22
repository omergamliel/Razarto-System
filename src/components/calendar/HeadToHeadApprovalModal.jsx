import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, Clock, ArrowDown, CheckCircle, XCircle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { resolveOwnerId } from './whatsappTemplates';

export default function HeadToHeadApprovalModal({ 
  isOpen, 
  onClose, 
  targetShiftId, 
  offerShiftId,
  onApprove,
  onDecline 
}) {
  // Fetch Shifts
  const { data: allShifts = [], isLoading } = useQuery({
    queryKey: ['all-shifts-h2h-approve'],
    queryFn: () => base44.entities.Shift.list(),
    enabled: isOpen && !!targetShiftId && !!offerShiftId
  });

  // Fetch Users (to display names correctly)
  const { data: authorizedPeople = [] } = useQuery({
      queryKey: ['users-h2h-approve'],
      queryFn: () => base44.entities.AuthorizedPerson.list(),
      enabled: isOpen
  });

  // Ownership comes from the base "assignment" ShiftCoverage row (Phase 4).
  const { data: coverages = [] } = useQuery({
      queryKey: ['coverages'],
      queryFn: () => base44.entities.ShiftCoverage.list(),
      enabled: isOpen
  });

  // Helper to enrich shift with name
  const getShiftInfo = (id) => {
      const shift = allShifts.find(s => s.id === id);
      if (!shift) return null;
      const user = authorizedPeople.find(
        u => Number(u.serial_id) === Number(resolveOwnerId(shift, coverages)),
      );
      return { ...shift, user_name: user?.full_name || 'לא ידוע' };
  };

  const targetShift = getShiftInfo(targetShiftId);
  const offerShift = getShiftInfo(offerShiftId);

  if (!isOpen) return null;

  if (isLoading) return <div className="fixed inset-0 bg-black/60 flex items-center justify-center text-white">טוען...</div>;
  if (!targetShift || !offerShift) return null;

  const ShiftCard = ({ shift, label, type }) => {
    const isOutgoing = type === 'outgoing';
    const bgColor = isOutgoing ? 'bg-red-50' : 'bg-green-50';
    const borderColor = isOutgoing ? 'border-red-100' : 'border-green-100';
    const textColor = isOutgoing ? 'text-red-700' : 'text-green-700';
    const iconColor = isOutgoing ? 'text-red-500' : 'text-green-500';

    return (
      <div className={`relative p-4 rounded-2xl border-2 ${borderColor} ${bgColor} transition-all`}>
        <div className="flex justify-between items-start mb-2">
            <span className={`text-xs font-bold px-2 py-1 rounded-full bg-white/60 ${textColor}`}>{label}</span>
            {isOutgoing ? <ArrowDown className="w-4 h-4 text-red-400 opacity-50" /> : <CheckCircle className="w-4 h-4 text-green-400 opacity-50" />}
        </div>
        <div className="flex flex-col gap-1">
            <h3 className="text-lg font-bold text-gray-800 leading-tight">{shift.user_name}</h3>
            <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                <Calendar className={`w-3.5 h-3.5 ${iconColor}`} />
                <span className="font-medium">{format(new Date(shift.start_date), 'EEEE, d בMMMM', { locale: he })}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
                <Clock className="w-3.5 h-3.5 opacity-70" />
                <span>09:00 - 09:00</span>
            </div>
        </div>
      </div>
    );
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-5 text-white text-center relative shrink-0">
            <button onClick={onClose} className="absolute top-4 left-4 p-2 rounded-full hover:bg-white/20 transition-colors"><X className="w-5 h-5" /></button>
            <h2 className="text-xl font-bold">אישור החלפה</h2>
            <p className="text-purple-100 text-xs mt-0.5">ראש בראש 🔄</p>
          </div>
          <div className="p-5 overflow-y-auto">
            <div className="flex flex-col gap-3 relative">
                <ShiftCard shift={targetShift} label="אתה נותן (מוותר)" type="outgoing" />
                <div className="flex justify-center -my-2 relative z-10"><div className="bg-white border-2 border-gray-100 rounded-full p-1.5 shadow-sm"><ArrowDown className="w-5 h-5 text-gray-400" /></div></div>
                <ShiftCard shift={offerShift} label="אתה מקבל" type="incoming" />
            </div>
          </div>
          <div className="p-5 pt-0 mt-auto flex gap-3 shrink-0">
            <Button onClick={onDecline} variant="outline" className="flex-1 h-12 rounded-xl border-gray-200 text-gray-600 hover:bg-gray-50"><XCircle className="w-4 h-4 ml-1.5" /> לא עכשיו</Button>
            <Button onClick={onApprove} className="flex-1 h-12 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white rounded-xl shadow-md"><CheckCircle className="w-4 h-4 ml-1.5" /> אשר החלפה</Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}