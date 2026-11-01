import { isActiveGroupMember as isActiveGroupMemberRule } from "@/lib/utils";
import { holidayDayKeys } from "@/lib/holidayDivisions";

// The day types the fairness matrix can be sliced by. Everything except חגים is
// counted per group; a chag's shifts are split between individual people, so
// that tab is shown per user.
export const FAIRNESS_TABS = [
  { id: "all", label: "הכל" },
  { id: "holidays", label: "לפי חגים" },
  { id: "weekends", label: 'לפי סופ"שים' },
  { id: "thursdays", label: "לפי ימי חמישי" },
  { id: "regular", label: "לפי ימים רגילים" },
];

// Every 'yyyy-MM-dd' covered by any Holiday range.
export function holidayDateSet(holidays = []) {
  const set = new Set();
  holidays.forEach((h) => {
    holidayDayKeys(h.start_date, h.end_date).forEach((key) => set.add(key));
  });
  return set;
}

// Which tab a single day belongs to — a chag day wins over its weekday.
export function dayCategory(dateKey, holidayDates) {
  if (!dateKey) return "regular";
  if (holidayDates?.has(dateKey)) return "holidays";
  const dow = new Date(`${dateKey}T00:00:00`).getDay(); // 0 = Sunday
  if (dow === 5 || dow === 6) return "weekends"; // Friday / Saturday
  if (dow === 4) return "thursdays";
  return "regular";
}

// Builds both presentations of one slice: the per-user list and the per-group
// list (a group's count is the sum of its members').
export function buildFairnessView({
  counts,
  people,
  currentUser,
  shiftGroups,
  activeOnly = false,
}) {
  const countOf = (serialId) => counts.get(serialId) || 0;
  // The holidays tab lists only people who are currently active in a group —
  // they are the ones the chags are actually divided between.
  const pool = activeOnly
    ? people.filter((p) => isActiveGroupMemberRule(p, shiftGroups))
    : people;

  const users = pool
    .map((p) => ({
      id: p.id,
      name: p.full_name || "לא ידוע",
      department: p.department,
      count: countOf(p.serial_id),
      isMe: currentUser && p.serial_id === currentUser.serial_id,
    }))
    .sort((a, b) => {
      // Current user (if RR and present) always floats to the top.
      if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
      return b.count - a.count || a.name.localeCompare(b.name, "he");
    });

  const groupsMap = new Map(); // symbol -> { members: [], count }
  pool.forEach((p) => {
    if (!p.sign) return;
    if (!groupsMap.has(p.sign)) groupsMap.set(p.sign, { members: [], count: 0 });
    const g = groupsMap.get(p.sign);
    g.members.push(p);
    g.count += countOf(p.serial_id);
  });

  const mySign = currentUser?.sign;
  const groups = Array.from(groupsMap.entries())
    .map(([symbol, g]) => {
      const members = g.members
        .map((m) => ({
          id: m.id,
          name: m.full_name || "לא ידוע",
          // A group's active member is listed first for the group.
          isActive: isActiveGroupMemberRule(m, shiftGroups),
        }))
        .sort((a, b) => {
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
          return a.name.localeCompare(b.name, "he");
        });
      return {
        symbol,
        label: `קבוצה ${symbol}`,
        members,
        hasActive: members.some((m) => m.isActive),
        count: g.count,
        isMine: mySign && symbol === mySign,
      };
    })
    .sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol, "he"));

  const maxCount = Math.max(
    ...users.map((u) => u.count),
    ...groups.map((g) => g.count),
    1,
  );

  return { users, groups, maxCount };
}