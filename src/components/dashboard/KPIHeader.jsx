import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Clock, CheckCircle, Calendar, ArrowLeftRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

export default function KPIHeader({ currentUser, onKPIClick, onStartSwitchFlow }) {

  // --- 1. Swap Requests Count (Red) ---
  // Count ALL open SwapRequests that are of type 'Full'
  const { data: fullRequestsCount = 0 } = useQuery({
    queryKey: ['count-full-swap-requests'],
    queryFn: async () => {
        const reqs = await base44.entities.SwapRequest.filter({ 
            status: 'Open',
            request_type: 'Full'
        });
        return reqs.length;
    }
  });

  // --- 2. Partial Gaps Count (Yellow) ---
  // Count ALL open SwapRequests that are of type 'Partial'
  const { data: partialRequestsCount = 0 } = useQuery({
    queryKey: ['count-partial-swap-requests'],
    queryFn: async () => {
        const reqs = await base44.entities.SwapRequest.filter({ 
            status: 'Open',
            request_type: 'Partial'
        });
        // Also count Partially_Covered status as relevant
        const partialStatusReqs = await base44.entities.SwapRequest.filter({ 
            status: 'Partially_Covered'
        });
        
        return reqs.length + partialStatusReqs.length;
    }
  });

  // --- 3. History / Approved (Green) ---
  // Count Shifts with status 'Covered' (or similar logic from history)
  // For simplicity, let's count closed requests
  const { data: approvedCount = 0 } = useQuery({
    queryKey: ['count-approved-swaps'],
    queryFn: async () => {
        const closedReqs = await base44.entities.SwapRequest.filter({ status: 'Closed' });
        const completedReqs = await base44.entities.SwapRequest.filter({ status: 'Completed' });
        return closedReqs.length + completedReqs.length;
    }
  });

  // --- 4. My Future Shifts (Blue) ---
  // Complex logic: Original assignment OR Approved coverage
  const { data: myShiftsCount = 0 } = useQuery({
    queryKey: ['count-my-future-shifts', currentUser?.serial_id],
    queryFn: async () => {
        if (!currentUser?.serial_id) return 0;
        
        const todayStr = new Date().toISOString().split('T')[0];

        // A. Shifts where I am the original user (and no active swap request replacing me completely)
        // Note: This logic can be refined. For now, simple count of future assignments.
        // We filter locally because simple filter might not support date operator > directly in all adaptors
        const myOriginalShifts = await base44.entities.Shift.filter({ 
            original_user_id: currentUser.serial_id
        });
        
        const futureOriginals = myOriginalShifts.filter(s => s.start_date >= todayStr);

        // B. Coverages where I am covering (Approved)
        const myCoverages = await base44.entities.ShiftCoverage.filter({
            covering_user_id: currentUser.serial_id,
            status: 'Approved'
        });
        
        const futureCoverages = myCoverages.filter(c => c.cover_start_date >= todayStr);

        return futureOriginals.length + futureCoverages.length;
    },
    enabled: !!currentUser?.serial_id
  });

  const kpis = [
    {
      id: 'swap_requests',
      mobileTitle: 'בקשות למלאה',
      desktopTitle: 'בקשות להחלפה מלאה',
      count: fullRequestsCount,
      icon: AlertCircle,
      gradient: 'from-red-500 to-red-600',
      bgColor: 'bg-red-50',
      textColor: 'text-red-600',
      borderColor: 'border-red-200'
    },
    {
      id: 'partial_gaps',
      mobileTitle: 'בקשות לחלקית',
      desktopTitle: 'בקשות להחלפה חלקית',
      count: partialRequestsCount,
      icon: Clock,
      gradient: 'from-yellow-500 to-yellow-600',
      bgColor: 'bg-yellow-50',
      textColor: 'text-yellow-600',
      borderColor: 'border-yellow-200'
    },
    {
      id: 'approved',
      mobileTitle: 'היסטוריה',
      desktopTitle: 'היסטוריית החלפות',
      count: approvedCount,
      icon: CheckCircle,
      gradient: 'from-green-500 to-green-600',
      bgColor: 'bg-green-50',
      textColor: 'text-green-600',
      borderColor: 'border-green-200'
    },
    {
      id: 'my_shifts',
      mobileTitle: 'המשמרות שלי',
      desktopTitle: 'המשמרות העתידיות שלי',
      count: myShiftsCount,
      icon: Calendar,
      gradient: 'from-blue-500 to-blue-600',
      bgColor: 'bg-blue-50',
      textColor: 'text-blue-600',
      borderColor: 'border-blue-200'
    },
    {
      id: 'switch_request',
      isAction: true,
      mobileTitle: 'בקשת החלפה',
      desktopTitle: 'התחל בקשת החלפה',
      icon: ArrowLeftRight,
      gradient: 'from-purple-500 to-purple-600',
      bgColor: 'bg-purple-50',
      textColor: 'text-purple-600',
      borderColor: 'border-purple-200'
    }
  ];

  return (
    <div className="grid grid-cols-4 gap-2 mb-6">
      {kpis.map((kpi, index) => (
        <motion.div
          key={kpi.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
          onClick={() => onKPIClick && onKPIClick(kpi.id)}
          className={`
            ${kpi.bgColor} border ${kpi.borderColor} 
            rounded-xl cursor-pointer hover:shadow-md transition-all
            flex flex-col items-center justify-center text-center
            p-2 md:p-4 md:flex-row md:gap-3 md:items-center md:text-right
            h-full
          `}
        >
          <div className={`p-1.5 md:p-3 rounded-lg md:rounded-xl bg-gradient-to-br ${kpi.gradient} text-white shadow-sm mb-1 md:mb-0`}>
            <kpi.icon className="w-4 h-4 md:w-6 md:h-6" />
          </div>

          <div className="flex flex-col items-center md:items-start">
            <span className={`text-xl md:text-3xl font-extrabold ${kpi.textColor} leading-none mb-1 md:mb-0`}>
              {kpi.count}
            </span>
            
            <p className="text-[10px] md:text-xs font-bold text-gray-700 leading-tight">
              <span className="md:hidden block px-1">{kpi.mobileTitle}</span>
              <span className="hidden md:block">{kpi.desktopTitle}</span>
            </p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}