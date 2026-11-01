import React from "react";

const DEPARTMENT_LABELS = {
  א: "מחלקה א",
  מ: "מחלקה מ",
  ת: "מחלקה ת",
};

// Per-user fairness list — used by the "לפי חגים" tab, where a chag's shifts are
// split between individual people rather than between group slots.
export default function FairnessUserList({ users = [], maxCount = 1, emptyText }) {
  if (users.length === 0) {
    return (
      <div className="text-center py-10 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
        <p className="text-gray-500 font-medium">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {users.map((u) => (
        <div
          key={u.id}
          className={`rounded-xl px-3 py-2 border transition-colors ${
            u.isMe
              ? "bg-blue-50 border-blue-300 ring-1 ring-blue-200"
              : "bg-gray-50 border-gray-100"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-semibold text-gray-800 text-sm truncate">
                {u.name}
              </span>
              {u.department && (
                <span className="text-[11px] text-gray-400 shrink-0">
                  {DEPARTMENT_LABELS[u.department] || `מחלקה ${u.department}`}
                </span>
              )}
            </div>
            <span className="text-sm font-bold text-gray-700 shrink-0">
              {u.count}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full bg-gradient-to-l from-blue-400 to-indigo-500 rounded-full transition-all"
              style={{ width: `${(u.count / maxCount) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}