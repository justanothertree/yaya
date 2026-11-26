/**
 * The PUBLIC half of the site's VAPID key pair, as base64url (an uncompressed P-256 point, 65
 * bytes, 87 characters).
 *
 * ⚠️ PUBLIC BY DESIGN. Every browser that subscribes is handed this key and sends it to its push
 * service, which then accepts only messages signed by the matching private half. Knowing it lets
 * nobody send anything. The private half is the edge-function secret `VAPID_PRIVATE_KEY` and never
 * appears in this repository.
 *
 * ⚠️ IT MUST BE THE SAME STRING AS THE `push` FUNCTION'S SECRET `VAPID_PUBLIC_KEY`. A browser
 * subscribes under this key; the function signs with the private half and names the public half
 * in every token, and a push service refuses a token whose key is not the one the subscription
 * was made under — 403, final, for every device. The function checks its own two secrets are one
 * pair before it sends anything ("the two VAPID keys are not one pair" in its log), but it cannot
 * see this file, so a new pair means changing both, together.
 *
 * ⚠️ EMPTY MEANS DARK. "📱 Phone alerts" in Account renders nothing while this is '', which is how
 * the tables, the functions, the worker and the card all shipped before the key existed (#454).
 * Generated on 22 Nov 2026 and filled in once both secrets are on the function — see
 * docs/2026-11-22-phone-alerts.md, "Secrets: the one thing to ask for".
 */
export const VAPID_PUBLIC_KEY =
  'BCS3NxFhsPiGnqEVlSbC4OzUN5zP2f79QdsTUzXGzS8t38wY4cILxyBKMHsDXuWkg3IVw01cbzYaNJdPgkDPneI'
