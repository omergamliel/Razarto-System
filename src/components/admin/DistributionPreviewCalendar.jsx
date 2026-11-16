import React, { useEffect, useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { MARK_COLORS, WEEKDAY_LABELS, personColor, personColorDim } from "./previewModel";

const TIP_WIDTH = 196;
const CLEAR_DELAY = 220;

// Which constraints belong to the current view: all of them normally, and only
// the highlighted person's when a person is highlighted — so their own אילוצים
// show up among their shifts and nobody else's do.
const constraintsFor = (list, highlight) =>
  highlight == null
    ? list || []
    : (list || []).filter((c) => Number(c?.serial_id) === Number(highlight));

// One cell of the yearly calendar: the day number, who works it, a marker for a
// chag day, an unfilled day, a second shift in the same week — and a dot when
// someone asked to be free that day (אילוץ).
function DayCell({ cell, dimmed, constraints, onHover, onLeave }) {
  if (cell.blank) return <span className="aspect-square" />;

  const style = {};
  if (cell.hue != null) {
    style.background = dimmed
      ? personColorDim(cell.hue)
      : personColor(cell.hue);
  } else if (cell.existing) {
    style.background = dimmed ? MARK_COLORS.dim : MARK_COLORS.existing;
  }
  if (!dimmed && cell.category === "holidays") {
    style.boxShadow = `inset 0 0 0 1.5px ${MARK_COLORS.holiday}`;
  }
  if (!dimmed && cell.unfilled) {
    style.border = `1px dashed ${MARK_COLORS.warning}`;
  }

  const blockCount = constraints.length;
  // While a person is highlighted the cell's own tooltip drops the constraints
  // of everyone else, like the dot does.
  const title =
    blockCount === (cell.constraints?.length || 0)
      ? cell.title
      : String(cell.title || "").split(" · אילוץ:")[0];

  return (
    <div
      title={title}
      style={style}
      onMouseEnter={
        blockCount ? (event) => onHover(event, cell.key) : undefined
      }
      onMouseLeave={blockCount ? onLeave : undefined}
      className={`relative aspect-square rounded overflow-hidden ${
        blockCount ? "cursor-pointer ring-1 ring-amber-400/70" : ""
      }`}
    >
      {/* Only the day number/name dims on top of the drained background, so
          the highlighted person's constraint dots stay fully visible. */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center leading-none transition-opacity ${
          dimmed ? "opacity-30" : ""
        }`}
      >
        <span className="text-[8px] text-gray-500">{cell.day}</span>
        <span
          className={`text-[9px] font-bold ${
            cell.short ? "text-gray-800" : "text-gray-500"
          }`}
        >
          {cell.short || cell.existingShort}
        </span>
        {cell.overflow && (
          <span
            className="absolute bottom-0 left-0 right-0 h-[3px]"
            style={{ background: MARK_COLORS.warning }}
          />
        )}
      </div>
      {blockCount > 0 && (
        <span
          className="absolute top-0.5 right-0.5 w-[6px] h-[6px] rounded-full ring-1 ring-white"
          style={{ background: MARK_COLORS.constraint }}
        />
      )}
    </div>
  );
}

/**
 * The range as a month grid. Days carrying an אילוץ get a dot, and hovering one
 * opens a small card listing who asked for that day — each with a delete button
 * that removes the request and recomputes the distribution.
 */
export default function DistributionPreviewCalendar({
  months,
  highlight,
  constraintByKey,
  onDeleteConstraint,
  deletingId,
  isRunning,
}) {
  const rootRef = useRef(null);
  const clearTimer = useRef(null);
  const [tip, setTip] = useState(null);

  useEffect(() => () => clearTimeout(clearTimer.current), []);

  const cancelClear = () => {
    clearTimeout(clearTimer.current);
    clearTimer.current = null;
  };

  const scheduleClear = () => {
    cancelClear();
    clearTimer.current = setTimeout(() => setTip(null), CLEAR_DELAY);
  };

  const handleHover = (event, key) => {
    cancelClear();
    const root = rootRef.current;
    if (!root) return;
    const cell = event.currentTarget.getBoundingClientRect();
    const base = root.getBoundingClientRect();
    const offsetTop = cell.top - base.top;
    const up = offsetTop > 140;
    const left = Math.max(
      0,
      Math.min(
        cell.left - base.left + cell.width / 2 - TIP_WIDTH / 2,
        base.width - TIP_WIDTH,
      ),
    );
    setTip({
      key,
      left,
      top: up ? offsetTop : cell.bottom - base.top + 4,
      up,
    });
  };

  const tipConstraints = tip
    ? constraintsFor(constraintByKey?.get(tip.key), highlight)
    : [];

  return (
    <div ref={rootRef} className="relative">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {months.map((month) => (
          <div
            key={month.key}
            className="bg-white rounded-xl border border-gray-100 shadow-sm p-2.5"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-gray-700">
                {month.label}
              </span>
              <span className="text-[10px] text-gray-400">
                {month.count} משמרות
              </span>
            </div>
            <div className="grid grid-cols-7 gap-[3px]">
              {WEEKDAY_LABELS.map((label, index) => (
                <span
                  key={label}
                  className={`text-[9px] text-center ${
                    index >= 5 ? "text-gray-700 font-semibold" : "text-gray-400"
                  }`}
                >
                  {label}
                </span>
              ))}
              {month.cells.map((cell) => (
                <DayCell
                  key={cell.id}
                  cell={cell}
                  constraints={constraintsFor(cell.constraints, highlight)}
                  dimmed={highlight != null && cell.owner !== highlight}
                  onHover={handleHover}
                  onLeave={scheduleClear}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {tip && tipConstraints.length > 0 && (
        <div
          dir="rtl"
          onMouseEnter={cancelClear}
          onMouseLeave={scheduleClear}
          className="absolute z-30 bg-white rounded-lg border border-gray-200 shadow-xl p-1.5 text-right"
          style={{
            left: tip.left,
            top: tip.top,
            width: TIP_WIDTH,
            transform: tip.up ? "translateY(-100%)" : undefined,
          }}
        >
          <p className="text-[10px] font-semibold text-amber-700 px-1 pb-1 border-b border-gray-100">
            אילוץ · {tip.key.slice(8, 10)}/{tip.key.slice(5, 7)}/{tip.key.slice(0, 4)}
          </p>
          {tipConstraints.map((constraint) => (
            <div
              key={constraint.id}
              className="flex items-center justify-between gap-1.5 py-0.5 px-1"
            >
              <span className="text-[11px] text-gray-700 truncate min-w-0">
                {constraint.user_name}
              </span>
              <button
                type="button"
                aria-label={`מחיקת האילוץ של ${constraint.user_name}`}
                title="מחיקת האילוץ"
                onClick={() => onDeleteConstraint?.(constraint)}
                disabled={isRunning || deletingId != null}
                className="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded text-red-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
              >
                {deletingId === constraint.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}