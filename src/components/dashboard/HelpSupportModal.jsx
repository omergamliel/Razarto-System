import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, HelpCircle, ChevronDown, ChevronUp, Compass, Video, Lightbulb, Users, Play } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function HelpSupportModal({ isOpen, onClose }) {
  const [expandedIndex, setExpandedIndex] = useState(null);
  const [infoMessage, setInfoMessage] = useState('');
  const [showVideo, setShowVideo] = useState(false);

  // FAQ items are managed by admins via AdminSettingsModal and stored in the
  // FaqItem entity — this modal just reads them, sorted by `order`.
  const { data: faqItems = [] } = useQuery({
    queryKey: ["faq-items"],
    queryFn: () => base44.entities.FaqItem.list("order"),
    enabled: isOpen,
  });

  if (!isOpen) return null;

  const quickLinks = [
    {
      icon: Compass,
      label: 'סיור באתר',
      color: 'from-blue-500/90 to-blue-600',
      shadow: 'shadow-blue-200',
      accent: 'bg-white/20 text-white',
      onClick: () => {
        setShowVideo(false);
        setInfoMessage('בקרוב יתווסף סיור באתר');
      }
    },
    {
      icon: Video,
      label: 'סרטון הדרכה',
      color: 'from-purple-500 to-indigo-600',
      shadow: 'shadow-purple-200',
      accent: 'bg-white/15 text-white',
      onClick: () => {
        setInfoMessage('');
        setShowVideo(true);
      }
    },
    {
      icon: Lightbulb,
      label: 'הצעות ובעיות במערכת',
      color: 'from-emerald-500 to-teal-600',
      shadow: 'shadow-emerald-200',
      accent: 'bg-white/20 text-white',
      onClick: () => {
        setShowVideo(false);
        setInfoMessage('');
        window.open('https://wa.me/972536221840', '_blank');
      }
    },
    {
      icon: Users,
      label: 'משתמשים והרשאות',
      color: 'from-teal-500 to-cyan-600',
      shadow: 'shadow-teal-200',
      accent: 'bg-white/20 text-white',
      onClick: () => {
        setShowVideo(false);
        setInfoMessage('');
        window.open('https://wa.me/972546881831', '_blank');
      }
    }
  ];

  const toggleExpand = (index) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" dir="rtl">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          // שיניתי ל-max-w-2xl וסידרתי גובה למובייל
          className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-500 to-blue-600 p-5 md:p-6 text-white flex-shrink-0">
            <button
              onClick={onClose}
              className="absolute top-4 left-4 p-2 rounded-full hover:bg-white/20 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="flex items-center gap-3">
              <div className="p-2.5 md:p-3 bg-white/20 rounded-xl">
                <HelpCircle className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl md:text-2xl font-bold">מרכז עזרה ותמיכה</h2>
                <p className="text-white/90 text-xs md:text-sm mt-1">כל מה שצריך לדעת על המערכת</p>
              </div>
            </div>
          </div>

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto p-5 md:p-6">

            {/* Quick Links - Responsive Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {quickLinks.map((link, index) => {
                const Icon = link.icon;
                return (
                  <motion.button
                    key={index}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={link.onClick}
                    className={`relative overflow-hidden flex md:block items-center gap-3 md:gap-0 p-4 md:p-5 rounded-2xl border border-white/40 backdrop-blur-sm transition-all text-right md:text-center shadow-lg ${link.shadow}
                      bg-gradient-to-br ${link.color} text-white hover:-translate-y-1 hover:shadow-2xl focus:outline-none focus:ring-2 focus:ring-white/60 focus:ring-offset-0`}
                  >
                    <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${link.accent} md:mx-auto md:mb-3`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 md:flex md:flex-col md:items-center">
                      <p className="text-sm font-semibold drop-shadow-sm md:text-base">{link.label}</p>
                    </div>
                  </motion.button>
                );
              })}
            </div>

            <AnimatePresence>
              {showVideo && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  className="mb-6 overflow-hidden rounded-2xl border border-purple-100 bg-gradient-to-br from-purple-50 via-white to-indigo-50 shadow-xl"
                >
                  <div className="flex items-center justify-between p-4 md:p-5 gap-3" dir="rtl">
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 rounded-2xl bg-purple-600 text-white flex items-center justify-center shadow-lg">
                        <Play className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm md:text-base font-semibold text-gray-900">סרטון הצגת מערכת Razarto</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowVideo(false)}
                      className="text-gray-500 hover:text-gray-700 transition-colors"
                      aria-label="סגור וידאו"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="relative w-full aspect-[16/9] bg-black">
                    <iframe
                      className="absolute inset-0 h-full w-full"
                      src="https://www.youtube.com/embed/9u12tJQ1KF4?autoplay=1&controls=0&modestbranding=1&rel=0&playsinline=1&enablejsapi=1&mute=0"
                      title="סרטון הדרכה"
                      allow="autoplay; encrypted-media; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {infoMessage && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 shadow-sm"
                >
                  {infoMessage}
                </motion.div>
              )}
            </AnimatePresence>

            {/* FAQ Section */}
            <div className="mb-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                שאלות נפוצות
              </h3>
              <div className="space-y-3">
                {faqItems.map((item, index) => (
                  <div
                    key={index}
                    className="border border-gray-200 rounded-xl overflow-hidden bg-white hover:shadow-sm transition-all"
                  >
                    <button
                      onClick={() => toggleExpand(index)}
                      className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors text-right"
                    >
                      <span className="font-semibold text-gray-800 text-sm md:text-base leading-tight ml-3">
                        {item.question}
                      </span>
                      {expandedIndex === index ? (
                        <ChevronUp className="w-5 h-5 text-gray-500 flex-shrink-0" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-gray-500 flex-shrink-0" />
                      )}
                    </button>
                    
                    <AnimatePresence>
                      {expandedIndex === index && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <div className="px-4 pb-4 text-sm text-gray-600 leading-relaxed border-t border-gray-100 pt-3">
                            {item.answer}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-5 md:p-6 pt-0 flex-shrink-0 bg-white border-t border-gray-100 mt-auto pt-4">
            <Button
              onClick={onClose}
              className="w-full h-12 bg-blue-500 hover:bg-blue-600 text-white rounded-xl shadow-md"
            >
              הבנתי, תודה!
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}