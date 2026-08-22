import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, serverUrl, token, functionsVersion } = appParams;

//Create a client with authentication required
export const base44 = createClient({
  appId,
  serverUrl,
  token,
  functionsVersion,
  requiresAuth: false
});

// --- Activity logging -------------------------------------------------------
// Every user action that changes a data entity is recorded to the ActivityLog
// entity, surfaced (newest first) under ניהול מערכת ▸ לוגים. The acting user is
// an AuthorizedPerson; it's registered once (from ShiftCalendar, which is always
// mounted for an authenticated user) so log calls don't have to thread it
// through every mutation — though a caller may still pass an explicit `actor`.
let currentActor = null;

export function setActivityActor(person) {
  currentActor = person || null;
}

// Fire-and-forget: logging must never break (or block) the action it records,
// so failures are swallowed with just a console warning.
export function logActivity({
  action,
  type,
  actor,
  status = "ok",
  entity,
  entityId,
} = {}) {
  const who = actor || currentActor;
  try {
    return base44.entities.ActivityLog.create({
      actor_id:
        who?.serial_id != null ? Number(who.serial_id) : undefined,
      actor_name: who?.full_name || who?.assigned_role || "מערכת",
      action,
      type,
      status,
      entity,
      entity_id: entityId != null ? String(entityId) : undefined,
    }).catch((e) => {
      console.error("logActivity failed:", e);
    });
  } catch (e) {
    console.error("logActivity failed:", e);
    return Promise.resolve();
  }
}
