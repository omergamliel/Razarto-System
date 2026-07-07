import React from 'react';
import ShiftCalendar from '@/components/calendar/ShiftCalendar';

export default function Home() {
  return (
    <>
      <ShiftCalendar />
      
      {/* זכויות יוצרים - קבוע למטה בצד שמאל */}
      <div className="fixed bottom-2 left-4 text-[10px] text-gray-400 font-medium select-none z-50 opacity-70 hover:opacity-100 transition-opacity" dir="rtl">
        © פותח ע״י ענף דיגיטל {new Date().getFullYear()}
      </div>
    </>
  );
}