// Shared Activity contract between ZEVANORY storefront and control panel.
// Pure, bounded, no access to customer content or provider secrets.
const FINANCIAL_TYPES = new Set(["payment_confirmed","refund_approved"]);
const ACTIVITY_TYPES = new Set([
  "checkout_created","payment_confirmed","delivery_sent","download_done",
  "refund_requested","refund_approved","refund_ambiguous","post_published",
  "whatsapp_replied","link_sent","lead_captured","email_sent",
  "owner_alert_sent","sales_switch","deploy","certification","review_received"
]);
const HEX64 = /^[a-f0-9]{64}$/;
const BASIC = /^[a-z0-9_-]{1,64}$/;
export const SHARED_ACTIVITY_TTL_SECONDS = 90*24*60*60;
export function normalizeSharedActivity(name: string, data: any) {
  if (!name.startsWith("zpc-activity:v1:") ||
      /^(?:zpc-activity:v1:ref:|zpc-activity:v1:processed:)/.test(name)) return null;
  const kindInKey=name.split(":")[2];
  if (!["event","support","lead","finance"].includes(kindInKey)) return null;
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.title !== "string") return null;
  if (data.schema === "zevanory.activity.v1") {
    if (kindInKey !== "event" || !ACTIVITY_TYPES.has(data.type) ||
        !HEX64.test(String(data.refHash||"")) ||
        data.sourceKey !== "zpc-activity:"+data.type+":"+data.refHash ||
        !BASIC.test(String(data.channel||"")) || !BASIC.test(String(data.status||"")))
      return null;
    const finance=FINANCIAL_TYPES.has(data.type);
    // Never treat mere checkout creation or an unverified payment as revenue.
    if (finance && data.financialProof !== "provider-get-verified") return null;
    const cents=data.amountCents;
    if (finance && (!Number.isSafeInteger(cents) || cents < 0 || cents > 1000000000)) return null;
    const link=String(data.link||"");
    if (link && (!/^https:\/\//.test(link) || link.includes("@") || link.includes("#"))) return null;
    return {
      kind:finance?"finance":"event",
      title:String(data.title).slice(0,100),
      detail:"",
      status:finance?(data.type==="payment_confirmed"?"confirmed":"refunded"):data.status,
      channel:data.channel,
      product:"ZEVANORY",
      source:finance?(data.type==="payment_confirmed"?"payment":"refund"):"zevanory-worker",
      sourceKey:data.sourceKey,
      valueCents:finance?cents:null,
      evidence:[data.type,"source:zevanory-worker",...(link?[link]:[])].slice(0,20)
    };
  }
  // Legacy Robot events: preserve readback behavior without treating them as
  // finance or reintroducing raw IDs into deduplication markers.
  if (kindInKey==="finance") return null;
  return {
    kind:kindInKey,
    title:data.title,
    detail:String(data.detail||""),
    status:String(data.status||"recorded").toLowerCase().replace(/[^a-z0-9-]/g,"-").slice(0,80),
    channel:String(data.channel||"email").slice(0,120),
    product:data.product?String(data.product):"ZEVANORY",
    source:"meta-robot",
    sourceKey:String(data.sourceKey||name),
    valueCents:null,
    evidence:Array.isArray(data.evidence)?data.evidence.map(String):[name]
  };
}
