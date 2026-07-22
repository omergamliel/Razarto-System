import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowLeftRight, Handshake, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STEPS = [
  { key: 'select', label: 'בחירת משמרת', icon: ArrowLeftRight },
  { key: 'type', label: 'סוג החלפה', icon: Handshake },
  { key: 'confirm', label: 'אישור', icon: CheckCircle2 },
];

export default function SwitchFlowBand({ currentStep = 'select', onCancel }) {
  const activeIndex = STEPS.findIndex((s) => s.key === currentStep);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.25 }}
        className="mb-4 rounded-2xl border-2 border-blue-200 bg-blue-50/80 backdrop-blur-sm px-3 md:px-5 py-3 shadow-sm"
        dir="rtl"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-blue-700">
            <ArrowLeftRight className="w-5 h-5" />
            <span className="text-sm md:text-base font-semibold">מצב החלפה</span>
          </div>

          <div className="flex items-center gap-1 md:gap-3">
            {STEPS.map((step, idx) => {
              const Icon = step.icon;
              const done = idx < activeIndex;
              const active = idx === activeIndex;
              return (
                <React.Fragment key={step.key}>
                  <div
                    className={`flex items-center gap-1.5 rounded-lg px-2 md:px-3 py-1 text-xs md:text-sm font-medium transition-colors ${
                      active
                        ? 'bg-blue-600 text-white'
                        : done
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-white text-gray-400 border border-gray-200'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 md:w-4 md:h-4" />
                    <span className="hidden sm:inline">{step.label}</span>
                  </div>
                  {idx < STEPS.length - 1 && (
                    <div
                      className={`h-px w-4 md:w-8 ${done ? 'bg-blue-400' : 'bg-gray-200'}`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {onCancel && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-blue-700 hover:bg-blue-100"
              onClick={onCancel}
              aria-label="ביטול מצב החלפה"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}