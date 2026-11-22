/**
 * The PUBLIC half of the site's VAPID key pair, as base64url (an uncompressed P-256 point, 65
 * bytes, 87 characters).
 *
 * ⚠️ PUBLIC BY DESIGN. Every browser that subscribes is handed this key and sends it to its push
 * service, which then accepts only messages signed by the matching private half. Knowing it lets
 * nobody send anything. The private half is the edge-function secret `VAPID_PRIVATE_KEY` and never
 * appears in this repository.
 *
 * ⚠️ EMPTY UNTIL THE SECRET STEP, AND EMPTY MEANS DARK. "📱 Phone alerts" in Account renders
 * nothing while this is '', so the tables, the functions, the worker and the card can all ship
 * before the key exists and nobody is offered a switch that cannot work. Filling it in is the
 * one-line change that turns the feature on, made in the same step that adds the private half —
 * see docs/2026-11-22-phone-alerts.md, "Secrets: the one thing to ask for".
 */
export const VAPID_PUBLIC_KEY = ''
