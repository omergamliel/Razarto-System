import { addDays, format } from "date-fns";
import { activeMemberSerialIdOnDate } from "@/lib/utils";

// Only RR/Manager users take part in the rotation.
const ROTATION_ROLES = ["RR", "Manager"];

const toKey = (date) => format(date, "yyyy-MM-dd");

// Every 'yyyy-MM-dd' from `fromKey` to `endKey` inclusive (empty when reversed).
const dayKeysBetween = (fromKey, endKey) => {
  const keys = [];
  if (!fromKey || !endKey || endKey < fromKey) return keys;
  for (
    let day = new Date(`${fromKey}T00:00:00`);
    toKey(day) <= endKey;
    day = addDays(day, 1)
  ) {
    keys.push(toKey(day));
  }
  return keys;
};

// Holidays are divided between PEOPLE, not between group slots (see the
// "חלוקות" value of each holiday in the חגים section). So alongside the group
// representatives the algorithm distributes ordinary days with, it also gets a
// per-USER pool for holiday blocks: the RR/Manager member ACTIVE in each active
// group, with their own constraints and the same windows the group's slot
// observes — the member leaving a group on a scheduled switch is a candidate
// only before it, the member joining only from it (and stays free through the
// grace period), and a scheduled deactivate removes the whole group's members.
// A group member who doesn't hold the group's active slot is never in the pool:
// only an active member of a group may be assigned shifts.
export function buildHolidayUserPool({
  groups,
  members,
  rawProtected,
  shifts = [],
  startDate,
  endDate,
  grace = 0,
}) {
  const people = [];
  const groupRepOf = new Map();
  const protectedDates = new Map();
  const seen = new Set();

  if (!groups?.size || !startDate || !endDate) {
    return { people, existingShifts: shifts, groupRepOf, protectedDates };
  }

  const addProtected = (serialId, dates) => {
    if (!dates || dates.size === 0) return;
    if (!protectedDates.has(serialId)) protectedDates.set(serialId, new Set());
    const set = protectedDates.get(serialId);
    dates.forEach((d) => set.add(d));
  };

  groups.forEach((group, symbol) => {
    const repSerial = activeMemberSerialIdOnDate(group, startDate);
    if (repSerial == null) return;

    const groupMembers = members.get(symbol) || [];
    const repKey = Number(repSerial);
    const rep = groupMembers.find((p) => Number(p.serial_id) === repKey);
    // Only RR/Manager members of a real, active group are in the rotation.
    if (!rep || !ROTATION_ROLES.includes(rep.permissions) || rep.sign !== symbol) {
      return;
    }

    const switchDate = group.scheduled_switch_date || null;
    const isDeactivate = !!switchDate && !!group.scheduled_switch_deactivate;
    const incomingSerial =
      switchDate && !isDeactivate && group.scheduled_switch_serial_id != null
        ? Number(group.scheduled_switch_serial_id)
        : null;
    const outgoingSerial =
      group.serial_id != null ? Number(group.serial_id) : repKey;

    // Dates each member must not be handed a holiday share on.
    const blockedByMember = new Map();
    const block = (serialId, keys) => {
      if (serialId == null || keys.length === 0) return;
      const key = Number(serialId);
      if (!blockedByMember.has(key)) blockedByMember.set(key, new Set());
      const set = blockedByMember.get(key);
      keys.forEach((d) => set.add(d));
    };

    if (isDeactivate) {
      const gone = dayKeysBetween(
        switchDate > startDate ? switchDate : startDate,
        endDate,
      );
      groupMembers.forEach((m) => block(m.serial_id, gone));
    } else if (switchDate && incomingSerial != null) {
      const afterSwitch = dayKeysBetween(switchDate, endDate);
      if (switchDate > startDate) {
        block(
          incomingSerial,
          dayKeysBetween(startDate, toKey(addDays(new Date(`${switchDate}T00:00:00`), -1))),
        );
        block(incomingSerial, afterSwitch.slice(0, Math.max(0, grace)));
        block(outgoingSerial, afterSwitch);
      } else if (outgoingSerial !== incomingSerial) {
        // The switch already happened before the range: the previous member is
        // no longer serving.
        block(outgoingSerial, dayKeysBetween(startDate, endDate));
      }
    }

    // The days on which each member actually holds this group's active slot,
    // resolved per day through the shared rule so a scheduled switch or
    // deactivate is honored exactly like the rest of the app.
    const activeDaysByMember = new Map();
    dayKeysBetween(startDate, endDate).forEach((day) => {
      const serial = activeMemberSerialIdOnDate(group, day);
      if (serial == null) return;
      const key = Number(serial);
      if (!activeDaysByMember.has(key)) activeDaysByMember.set(key, new Set());
      activeDaysByMember.get(key).add(day);
    });

    groupMembers.forEach((member) => {
      if (!ROTATION_ROLES.includes(member.permissions)) return;
      const key = Number(member.serial_id);
      if (Number.isNaN(key)) return;

      // Only a member who is active in the group on at least one day she isn't
      // blocked on takes holiday shares. Everyone else in the group (an
      // ordinary, non-active member, or one whose whole activity falls inside
      // their grace period) is out of the holiday rotation.
      const activeDays = activeDaysByMember.get(key);
      if (!activeDays || activeDays.size === 0) return;
      const blocked = blockedByMember.get(key);
      if (blocked && [...activeDays].every((d) => blocked.has(d))) return;

      if (!seen.has(key)) {
        seen.add(key);
        people.push({ serial_id: key, full_name: member.full_name });
        groupRepOf.set(key, repKey);
      }
      addProtected(key, rawProtected?.get(key));
      addProtected(key, blockedByMember.get(key));
    });
  });

  return { people, existingShifts: shifts, groupRepOf, protectedDates };
}