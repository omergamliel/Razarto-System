import React, { useState } from 'react';
import { format, addDays } from 'date-fns';
import { he } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, Plus, Users, Briefcase } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

export default function AddShiftModal({ 
  isOpen, 
  onClose, 
  date,
  onSubmit,
  isSubmitting,
  currentUser
}) {
  const [department, setDepartment] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');

  // Fetch authorized users from DB
  const { data: authorizedUsers = [] } = useQuery({
    queryKey: ['authorized-users'],
    queryFn: () => base44.entities.AuthorizedPerson.list(),
    enabled: isOpen
  });

  // Group "active member" records (ShiftGroup): only the active member of a
  // group can be assigned shifts — the same pool shift distribution uses.
  const { data: shiftGroups = [] } = useQuery({
    queryKey: ['shift-groups'],
    queryFn: () => base44.entities.ShiftGroup.list(),
    enabled: isOpen
  });
  const activeMemberEmails = new Set(
    shiftGroups
      .filter((group) => group.active && group.username)
      .map((group) => group.username.toLowerCase())
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selectedUserId) return;
    
    const selectedUser = authorizedUsers.find(u => u.serial_id === selectedUserId);
    if (!selectedUser) return;

    onSubmit({
      original_user_id: selectedUser.serial_id,
      start_date: format(date, 'yyyy-MM-dd'),
      end_date: format(addDays(date, 1), 'yyyy-MM-dd'),
      start_time: '09:00',
      end_time: '09:00'
    });
  };

  const handleDepartmentChange = (value) => {
    setDepartment(value);
    setSelectedUserId(''); // Reset user when department changes
  };

  if (!isOpen) return null;

  // Only the active member of a group can be assigned shifts — non-active
  // members (and anyone in no group) are excluded from the dropdown.
  const rrUsers = authorizedUsers.filter(u =>
    activeMemberEmails.has((u.email || '').toLowerCase())
  );

  // Get unique departments
  const departments = [...new Set(rrUsers.map(u => u.department))].sort();
  
  // Get users for selected department
  const usersInDepartment = department 
    ? rrUsers.filter(u => u.department === department)
    : [];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-[#64B5F6] to-[#42A5F5] p-6 text-white">
            <button
              onClick={onClose}
              className="absolute top-4 left-4 p-2 rounded-full hover:bg-white/20 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/20 rounded-xl">
                <Calendar className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">הוספת משמרת</h2>
                <p className="text-white/80 text-sm">
                  {date && format(date, 'EEEE, d בMMMM yyyy', { locale: he })}
                </p>
              </div>
            </div>
          </div>

          {/* Content */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Department Selection */}
            <div className="space-y-2">
              <Label className="text-gray-700 font-medium flex items-center gap-2">
                <Users className="w-4 h-4 text-[#64B5F6]" />
                בחר מחלקה
              </Label>
              <Select value={department} onValueChange={handleDepartmentChange}>
                <SelectTrigger className="h-12 rounded-xl border-2 border-gray-200 focus:border-[#64B5F6]">
                  <SelectValue placeholder="בחר מחלקה..." />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((dept) => (
                    <SelectItem key={dept} value={dept}>
                      {`מחלקה ${dept}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* User Selection */}
            <AnimatePresence>
              {department && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-2 overflow-hidden"
                >
                  <Label className="text-gray-700 font-medium flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-[#64B5F6]" />
                    בחר משתמש
                  </Label>
                  <Select value={selectedUserId.toString()} onValueChange={(val) => setSelectedUserId(parseInt(val))}>
                    <SelectTrigger className="h-12 rounded-xl border-2 border-gray-200 focus:border-[#64B5F6]">
                      <SelectValue placeholder="בחר משתמש..." />
                    </SelectTrigger>
                    <SelectContent>
                      {usersInDepartment.map((user) => (
                        <SelectItem key={user.serial_id} value={user.serial_id.toString()}>
                          {user.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={isSubmitting || !selectedUserId}
              className="w-full bg-gradient-to-r from-[#64B5F6] to-[#42A5F5] hover:from-[#42A5F5] hover:to-[#2196F3] text-white py-6 rounded-xl text-lg font-medium disabled:opacity-50"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1 }}
                  >
                    ⏳
                  </motion.div>
                  מוסיף...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  הוסף משמרת
                </span>
              )}
            </Button>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}