import React, { useState } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown, GripVertical, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

// Admin-only FAQ manager — reads/writes the FaqItem entity (shared with
// HelpSupportModal). Extracted from AdminSettingsModal to keep that file
// under the line limit.
export default function FaqManager() {
  const queryClient = useQueryClient();
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [drafts, setDrafts] = useState({});
  // FAQ item pending a delete confirmation, or null.
  const [faqToDelete, setFaqToDelete] = useState(null);

  const { data: faqItems = [], isLoading } = useQuery({
    queryKey: ["faq-items"],
    queryFn: () => base44.entities.FaqItem.list("order"),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["faq-items"] });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.FaqItem.create(data),
    onSuccess: () => {
      invalidate();
      toast.success("השאלה נוספה");
    },
    onError: () => toast.error("שגיאה בהוספת שאלה"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.FaqItem.update(id, data),
    onSuccess: () => invalidate(),
    onError: () => toast.error("שגיאה בעדכון שאלה"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.FaqItem.delete(id),
    onSuccess: () => {
      invalidate();
      toast.success("השאלה נמחקה");
      setFaqToDelete(null);
    },
    onError: () => toast.error("שגיאה במחיקת שאלה"),
  });

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    const nextOrder = faqItems.length
      ? Math.max(...faqItems.map((i) => i.order || 0)) + 1
      : 1;
    createMutation.mutate({
      question: "שאלה חדשה",
      answer: "הקלידו תשובה",
      order: nextOrder,
    });
  };

  const handleFieldChange = (id, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: value },
    }));
  };

  const handleFieldBlur = (item, field) => {
    const draft = drafts[item.id];
    if (!draft || draft[field] === undefined) return;
    if (draft[field] === item[field]) return;
    updateMutation.mutate({ id: item.id, data: { [field]: draft[field] } });
  };

  const moveFaq = (item, direction) => {
    const sorted = [...faqItems].sort((a, b) => (a.order || 0) - (b.order || 0));
    const index = sorted.findIndex((q) => q.id === item.id);
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= sorted.length) return;
    const neighbor = sorted[newIndex];
    updateMutation.mutate({ id: item.id, data: { order: neighbor.order } });
    updateMutation.mutate({ id: neighbor.id, data: { order: item.order } });
  };

  const getField = (item, field) =>
    drafts[item.id]?.[field] !== undefined
      ? drafts[item.id][field]
      : item[field];

  return (
    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-gray-800">שאלות נפוצות</p>
          <p className="text-xs text-gray-500">
            ניהול שאלות ותשובות — מוצגות גם במרכז העזרה לכל המשתמשים
          </p>
        </div>
        <Button
          onClick={handleAdd}
          className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-2 h-10 px-3"
        >
          <Plus className="w-4 h-4" /> הוספת שאלה
        </Button>
      </div>
      <div className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-gray-400 py-4 text-center">טוען...</p>
        ) : faqItems.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">
            אין שאלות עדיין — לחצו "הוספת שאלה" כדי להתחיל
          </p>
        ) : (
          faqItems.map((item, idx) => (
            <div
              key={item.id}
              className="border border-gray-100 rounded-xl p-3 bg-gradient-to-br from-white to-gray-50 shadow-sm"
            >
              <div className="flex items-start gap-2">
                <div className="flex flex-col items-center text-gray-400 pt-1">
                  <GripVertical className="w-4 h-4" />
                  <div className="flex flex-col text-[10px] text-gray-500">
                    <button
                      onClick={() => moveFaq(item, -1)}
                      className="hover:text-gray-700"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => moveFaq(item, 1)}
                      className="hover:text-gray-700"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => toggleExpand(item.id)}
                      className="text-right flex-1 text-sm font-semibold text-gray-800"
                    >
                      {getField(item, "question")}
                    </button>
                    <div className="flex items-center gap-2 text-gray-500">
                      <button
                        onClick={() => toggleExpand(item.id)}
                        className="p-2 rounded-lg hover:bg-gray-100"
                      >
                        {expandedIds.has(item.id) ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => setFaqToDelete(item)}
                        className="p-2 rounded-lg hover:bg-red-50 text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {expandedIds.has(item.id) && (
                    <div className="grid gap-2" dir="rtl">
                      <Label className="text-xs text-gray-600">שאלה</Label>
                      <Input
                        value={getField(item, "question")}
                        onChange={(e) =>
                          handleFieldChange(item.id, "question", e.target.value)
                        }
                        onBlur={() => handleFieldBlur(item, "question")}
                        className="rounded-xl"
                      />
                      <Label className="text-xs text-gray-600 mt-1">תשובה</Label>
                      <Textarea
                        value={getField(item, "answer")}
                        onChange={(e) =>
                          handleFieldChange(item.id, "answer", e.target.value)
                        }
                        onBlur={() => handleFieldBlur(item, "answer")}
                        className="rounded-xl min-h-[80px]"
                      />
                      <div className="flex items-center justify-end gap-2 text-xs text-gray-500">
                        <span>סעיף {idx + 1}</span>
                        <span className="flex items-center gap-1">
                          <PhoneCall className="w-3 h-3" /> תמיכה זמינה
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Delete FAQ confirmation */}
      <Dialog
        open={!!faqToDelete}
        onOpenChange={(o) => {
          if (!o) setFaqToDelete(null);
        }}
      >
        <DialogContent className="text-right" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle>מחיקת שאלה</DialogTitle>
            <DialogDescription>
              למחוק את השאלה <b>{faqToDelete?.question}</b>? הפעולה לא ניתנת
              לביטול.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setFaqToDelete(null)}>
              ביטול
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(faqToDelete.id)}
            >
              {deleteMutation.isPending ? "מוחק..." : "מחק"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}