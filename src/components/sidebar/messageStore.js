// Decoupled pub/sub store for the notification sidebar.
//
// Foundation only — nothing in the app creates messages here yet. Other
// components never import this module to *display* the sidebar; they only
// (optionally, later) call addMessage() to push a notification, and
// (optionally) listen for the 'razarto:sidebar-action' DOM event to open
// the relevant menu when a message's action button is pressed.
//
// A message is plain data:
//   { id, type, title, body, actionLabel, actionTarget, created_date }
// `type` is one of the shift-status codes established in ShiftCell.jsx
// (swap_requested | partial | covered | mine | holiday | info) and is
// mapped to colors/icons inside NotificationSidebar.jsx.

let messages = [];
const listeners = new Set();

export function getMessages() {
  return messages;
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(messages);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  const snapshot = messages;
  listeners.forEach((l) => l(snapshot));
}

export function addMessage({
  type = "info",
  title = "",
  body = "",
  actionLabel = "",
  actionTarget = null,
  // Stable identity of the underlying event (e.g. `gift-offer:<id>`). Kept on
  // the message so the scanner can auto-remove it once the event it stands for
  // no longer exists — a gift/swap that was accepted or cancelled.
  fingerprint = null,
}) {
  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    title,
    body,
    actionLabel,
    actionTarget,
    fingerprint,
    created_date: new Date().toISOString(),
  };
  messages = [message, ...messages];
  emit();
  return message.id;
}

export function removeMessage(id) {
  messages = messages.filter((m) => m.id !== id);
  emit();
}

// Remove any message that was raised for a given event fingerprint. Called by
// the scanner when the event a notification stood for no longer matches current
// data (e.g. an incoming gift offer was accepted, declined, or cancelled), so
// the popup doesn't linger after it's been resolved.
export function removeByFingerprint(fingerprint) {
  if (!fingerprint) return;
  const next = messages.filter((m) => m.fingerprint !== fingerprint);
  if (next.length !== messages.length) {
    messages = next;
    emit();
  }
}

export function clearAll() {
  messages = [];
  emit();
}

// Fired on action-button click. The sidebar stays one-way decoupled: it
// never imports the menu components — any component that wants to react
// listens for this event on `window`.
export function dispatchAction(actionTarget) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("razarto:sidebar-action", {
      detail: { target: actionTarget },
    }),
  );
}
