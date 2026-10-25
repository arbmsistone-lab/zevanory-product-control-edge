// Owner alert entry written by this panel Worker into the shared KV (`zpc-alert:v1:*`), which the central Worker's
// hourly cron e-mails as a digest (zevanory-public-mirror worker/owner-alerts.mjs, runOwnerAlertDigest).
// The digest only forwards entries whose `category` is in its ALLOWED_OWNER_ALERTS and DELETES the rest unsent:
// entries without `category` (the Instagram/Facebook alerts until now) were silently dropped. The category rule is
// the same one the central Worker uses for WhatsApp: refund/chargeback/cancel wording -> "refund", else "complaint".
export const OWNER_ALERT_PREFIX = 'zpc-alert:v1:';
export const OWNER_ALERT_TTL_S = 7 * 24 * 3600;
export const PANEL_ALERT_CATEGORIES = ['refund', 'complaint'] as const;
export type PanelAlertCategory = typeof PANEL_ALERT_CATEGORIES[number];

export function ownerAlertCategory(excerpt: string): PanelAlertCategory {
  return /reembols|estorno|cancelar/i.test(String(excerpt || '')) ? 'refund' : 'complaint';
}

export function maskPanelExcerpt(text: string) {
  return String(text || '').replace(/\b\d{6,}\b/g, '***').replace(/[^\s@]+@[^\s@]+/g, '***@***').slice(0, 280);
}

export function buildOwnerAlertEntry(input: { channel: string; reason: string; excerpt: string; eventId: string }, nowMs: number) {
  const key = OWNER_ALERT_PREFIX + nowMs + ':' + String(input.eventId || '').replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 60);
  const value = JSON.stringify({
    channel: input.channel, category: ownerAlertCategory(input.excerpt), reason: input.reason,
    excerpt: maskPanelExcerpt(input.excerpt), at: new Date(nowMs).toISOString(),
  });
  return { key, value, ttl: OWNER_ALERT_TTL_S };
}
