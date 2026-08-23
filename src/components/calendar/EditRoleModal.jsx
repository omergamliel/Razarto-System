import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, Save, Users, Briefcase } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

export default function EditRoleModal({ 
  isOpen, 
  onClose, 
  date,
  shift,
  onSubmit,
  isSubmitting
}) {
  const [department, setDepartment] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');

  // 1. Fetch authorized people instead of RoleDefinition
  const { data: authorizedPeople = [] } = useQuery({
    queryKey: ['authorized-people-edit'],
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

  // 2. Pre-fill data from existing shift
  useEffect(() => {
    if (shift && authorizedPeople.length > 0) {
      // Find the user based on the ID saved in the shift
      const originalUser = authorizedPeople.find(u => u.serial_id === shift.original_user_id);
      
      if (originalUser) {
        setDepartment(originalUser.department);
        setSelectedUserId(originalUser.serial_id.toString());
      } else {
        // Fallback or empty if not found
        setDepartment('');
        setSelectedUserId('');
      }
    }
  }, [shift, authorizedPeople]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!department || !selectedUserId) return;
    
    // We send the ID of the new user to be the "original" owner of this shift
    onSubmit({
      original_user_id: parseInt(selectedUserId)
    });
  };

  const handleDepartmentChange = (value) => {
    setDepartment(value);
    setSelectedUserId(''); // Reset user when department changes
  };

  if (!isOpen || !shift) return null;

  // Only the active member of a group can be assigned shifts — non-active
  // members (and anyone in no group) are excluded from the dropdown.
  const rrPeople = authorizedPeople.filter(u =>
    activeMemberEmails.has((u.email || '').toLowerCase())
  );

  // Get unique departments from AuthorizedPerson list
  const departments = ['א', 'מ', 'ת'];

  // Filter users by selected department
  const departmentUsers = rrPeople.filter(u => u.department === department);

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
                <h2 className="text-xl font-bold">שינוי משבץ</h2>
                <p className="text-white/80 text-sm">
                  {date && format(new Date(date), 'EEEE, d בMMMM yyyy', { locale: he })}
                </p>
              </div>
            </div>
          </div>

          {/* Content */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Current Assignment Display */}
            <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-4 border border-gray-200">
              <p className="text-sm text-gray-500 mb-1">משובץ כרגע:</p>
              <p className="font-semibold text-gray-800">{shift.user_name || 'לא ידוע'}</p>
            </div>

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
                      מחלקה {dept}
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
                    בחר אדם חדש
                  </Label>
                  <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                    <SelectTrigger className="h-12 rounded-xl border-2 border-gray-200 focus:border-[#64B5F6]">
                      <SelectValue placeholder="בחר אדם..." />
                    </SelectTrigger>
                    <SelectContent>
                      {departmentUsers.map((u) => (
                        <SelectItem key={u.serial_id} value={u.serial_id.toString()}>
                          {u.full_name}
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
              disabled={isSubmitting || !department || !selectedUserId}
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
                  מעדכן...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Save className="w-5 h-5" />
                  שמור שינויים
                </span>
              )}
            </Button>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}