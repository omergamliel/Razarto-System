import React from "react";
import { CATEGORY_LABELS, personColor } from "./previewModel";
import { cn } from "@/lib/utils";

const round1 = (value) => Math.round(value * 10) / 10;

// A count plus how far it is from the equal share for that kind of day.
function CountCell({ count, share }) {
  const deviation = round1(count - (share || 0));
  const tone =
    deviation >= 0.6
      ? "text-amber-700"
      : deviation <= -0.6
        ? "text-blue-700"
        : "text-gray-400";
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-mono font-semibold text-gray-800">{count}</span>
      <span className={cn("font-mono text-[10px]", tone)}>
        {deviation > 0 ? `+${deviation}` : deviation}
      </span>
    </span>
  );
}

export default function DistributionPreviewTable({ model, highlight, onHighlight }) {
  const { rows, fair } = model;
  const kinds = Object.keys(CATEGORY_LABELS);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-6">
        לא שובצו משמרות בטווח שנבחר.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-[11px] text-gray-500">
            <th className="text-right font-medium px-2 py-1.5">משתמש</th>
            <th className="font-medium px-2 py-1.5">סה״כ</th>
            {kinds.map((kind) => (
              <th key={kind} className="font-medium px-2 py-1.5">
                {CATEGORY_LABELS[kind]}
              </th>
            ))}
            <th className="font-medium px-2 py-1.5">עומס</th>
            <th className="font-medium px-2 py-1.5">מרווח מינ׳</th>
          </tr>
          <tr className="text-[10px] text-gray-400 border-b border-gray-100">
            <td className="px-2 py-1 text-right">חלק שווה</td>
            <td className="px-2 py-1 text-center font-mono">{fair.total}</td>
            {kinds.map((kind) => (
              <td key={kind} className="px-2 py-1 text-center font-mono">
                {fair[kind]}
              </td>
            ))}
            <td className="px-2 py-1 text-center font-mono">—</td>
            <td className="px-2 py-1 text-center font-mono">—</td>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.personId}
              onClick={() => onHighlight(highlight === row.personId ? null : row.personId)}
              className={cn(
                "border-b border-gray-50 cursor-pointer transition-colors",
                highlight === row.personId
                  ? "bg-blue-50"
                  : "hover:bg-blue-50/40",
              )}
            >
              <td className="px-2 py-1.5 text-right">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-3 h-3 rounded-full border border-black/20 shrink-0"
                    style={{ background: personColor(row.hue) }}
                  />
                  <span className="font-medium text-gray-800">{row.name}</span>
                  {row.group && (
                    <span className="text-[10px] text-gray-400">
                      קבוצה {row.group}
                    </span>
                  )}
                </span>
              </td>
              <td className="px-2 py-1.5 text-center">
                <CountCell count={row.total} share={fair.total} />
              </td>
              {kinds.map((kind) => (
                <td key={kind} className="px-2 py-1.5 text-center">
                  <CountCell count={row[kind]} share={fair[kind]} />
                </td>
              ))}
              <td className="px-2 py-1.5 text-center font-mono text-gray-600">
                {row.load}
              </td>
              <td className="px-2 py-1.5 text-center font-mono text-gray-600">
                {row.minGap == null ? "—" : `${row.minGap} ימים`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}