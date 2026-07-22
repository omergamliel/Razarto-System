import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SwitchFlowBand({ step, ownCount, targetCount, isSubmitting, onCancel, onNext, onConfirm }) {
  const isOwnStep = step === 'own';

  const title = isOwnStep
    ? 'בחרו את המשמרות שלכם שתרצו להציע להחלפה'
    : 'בחרו את המשמרות של אחרים שתרצו לקחת במקום';

  const counterText = isOwnStep
    ? `${ownCount} משמרות נבחרו`
    : `${targetCount} משמרות נבחרו`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        className="fixed bottom-0 left-0 right-0 z-50 bg-blue-600 text-white shadow-lg"
      >
        <div className="max-w-3xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
          <button
            onClick={onCancel}
            className="absolute top-2 left-2 sm:hidden text-blue-100 hover:text-white"
            aria-label="ביטול"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex-1 text-center sm:text-right">
            <p className="font-bold text-sm md:text-base">{title}</p>
            <p className="text-xs text-blue-100">{counterText}</p>
          </div>

          <div className="flex gap-2 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              ביטול
            </Button>

            {isOwnStep ? (
              <Button
                size="sm"
                onClick={onNext}
                disabled={ownCount === 0}
                className="bg-white text-blue-600 hover:bg-blue-50"
              >
                המשך
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={onConfirm}
                disabled={targetCount === 0 || isSubmitting}
                className="bg-white text-blue-600 hover:bg-blue-50"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'אישור ושליחה'}
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
