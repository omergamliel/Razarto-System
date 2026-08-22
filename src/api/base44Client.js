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

// --- Activity logging (ActivityLog entity) ---
// The acting user is registered once per session (ShiftCalendar calls
// setActivityActor) so every data mutation can be attributed without threading
// the actor through each call site. logActivity is fire-and-forget: a failed
// audit write must never break the user flow it records.
let currentActor = null;

export const setActivityActor = (actor) => {
  currentActor = actor || null;
};

export const logActivity = async ({
  action,
  type,
  entity,
  entityId,
  status = "ok",
  actor,
}) => {
  try {
    const a = actor || currentActor;
    await base44.entities.ActivityLog.create({
      action,
      type,
      entity,
      entity_id: entityId != null ? String(entityId) : undefined,
      status,
      actor_id: a?.serial_id != null ? Number(a.serial_id) : undefined,
      actor_name: a?.full_name || undefined,
    });
  } catch {
    // Swallow — logging is best-effort and must not surface in the UI.
  }
};