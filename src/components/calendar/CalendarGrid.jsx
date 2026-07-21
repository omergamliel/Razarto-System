import React from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameDay
} from 'date-fns';
import { he } from 'date-fns/locale';
import { motion } from 'framer-motion';
import ShiftCell from './ShiftCell';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useHolidays } from './useHolidays';

const HEBREW_DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const HEBREW_DAYS_FULL = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export default function CalendarGrid({ 
  currentDate, 
  viewMode, 
  shifts, 
  onCellClick,
  currentUserEmail,
  isAdmin = false
}) {

  // --- 1. Fetch Authorized People for Joining Data ---
  const { data: authorizedPeople = [] } = useQuery({
    queryKey: ['authorized-people-grid'],
    queryFn: () => base44.entities.AuthorizedPerson.list(),
  });

  // --- 2. Helper: Enrich Shift Data ---
  // מחבר בין המשמרת לבין פרטי המשתמש (שם, תפקיד)
  const getEnrichedShift = (shift) => {
    if (!shift) return null;
    
    const originalUser = authorizedPeople.find(u => u.serial_id === shift.original_user_id);
    
    return {
      ...shift,
      user_name: originalUser ? originalUser.full_name : 'לא משובץ',
      department: originalUser ? originalUser.department : '',
      // Role name can be fetched if we had a RoleDefinition table, 
      // but for now we assume original_user_id represents the "role/slot" owner.
      role_name: originalUser ? originalUser.full_name : 'פנוי' 
    };
  };

  const getDaysToDisplay = () => {
    if (viewMode === 'month') {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
      const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
      return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    } else {
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
      const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
      return eachDayOfInterval({ start: weekStart, end: weekEnd });
    }
  };

  const days = getDaysToDisplay();

  const { data: holidaysByDate = {} } = useHolidays(days.map((d) => d.getFullYear()));

  const getShiftForDate = (date) => {
    const rawShift = shifts.find((shift) => {
      const shiftDateStr = shift?.start_date || shift?.date;
      if (!shiftDateStr) return false;
      const shiftDate = new Date(shiftDateStr);
      if (isNaN(shiftDate.getTime())) return false;
      return isSameDay(shiftDate, date);
    });
    return getEnrichedShift(rawShift);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="relative z-10"
    >
      {/* Day Headers */}
      <div className="grid grid-cols-7 gap-2 mb-3">
        {HEBREW_DAYS.map((day, index) => (
          <div 
            key={index}
            className="text-center py-2 text-sm md:text-base font-semibold text-gray-600"
            title={HEBREW_DAYS_FULL[index]}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className={`
        grid grid-cols-7 gap-[2px] md:gap-3 px-0
        ${viewMode === 'week' ? 'auto-rows-fr min-h-[400px]' : ''}
      `}>
        {days.map((day, index) => (
          <motion.div
            key={format(day, 'yyyy-MM-dd')}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.02 }}
          >
            <ShiftCell
              date={day}
              shift={getShiftForDate(day)}
              onClick={onCellClick}
              currentMonth={currentDate}
              isWeekView={viewMode === 'week'}
              currentUserEmail={currentUserEmail}
              isAdmin={isAdmin}
            />
          </motion.div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-4 md:gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-gradient-to-br from-[#E3F2FD] to-[#BBDEFB] border border-[#64B5F6]" />
          <span className="text-gray-600">משמרות שלי</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-white border border-gray-200" />
          <span className="text-gray-600">משמרת רגילה</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-gradient-to-br from-[#FFEBEE] to-[#FFCDD2] border border-[#E57373]" />
          <span className="text-gray-600">בקשה להחלפה</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-gradient-to-br from-[#E8F5E9] to-[#C8E6C9] border border-[#66BB6A]" />
          <span className="text-gray-600">החלפה אושרה</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-gradient-to-br from-[#FFFDE7] to-[#FFF9C4] border border-[#FDD835]" />
          <span className="text-gray-600">כיסוי חלקי - פער</span>
        </div>
      </div>
    </motion.div>
  );
}