import assert from "node:assert/strict";
import { normalizeSharedActivity, SHARED_ACTIVITY_TTL_SECONDS } from "../cf-worker/shared-activity-contract";

const TYPES = [
  "checkout_created","payment_confirmed","delivery_sent","download_done",
  "refund_requested","refund_approved","refund_ambiguous","post_published",
  "whatsapp_replied","link_sent","lead_captured","email_sent",
  "owner_alert_sent","sales_switch","deploy","certification","review_received"
];
const HASH="a".repeat(64);
for(const type of TYPES){
  const finance=type==="payment_confirmed"||type==="refund_approved";
  const activity = {
    schema:"zevanory.activity.v1",type,title:type.replaceAll("_"," "),
    channel:finance?"finance":"web",status:"recorded",refHash:HASH,
    sourceKey:"zpc-activity:"+type+":"+HASH,
    link:null,amountCents:finance?3700:null,
    financialProof:finance?"provider-get-verified":null
  };
  const converted=normalizeSharedActivity("zpc-activity:v1:event:1234567890:"+HASH.slice(0,32),activity);
  assert.ok(converted,type);
  assert.equal(converted?.kind,finance?"finance":"event");
  assert.equal(converted?.sourceKey,activity.sourceKey);
  assert.equal(converted?.valueCents,finance?3700:null);
  if(type==="payment_confirmed"){
    assert.equal(converted.source,"payment");
    assert.equal(converted.status,"confirmed");
    assert.equal(normalizeSharedActivity("zpc-activity:v1:event:a:b",{...activity,financialProof:null}),null);
  }
  if(type==="refund_approved") assert.equal(converted.source,"refund");
  assert.ok(!JSON.stringify(converted).includes("customer"));
}
assert.equal(TYPES.length,17);
assert.equal(SHARED_ACTIVITY_TTL_SECONDS,90*86400);
assert.equal(normalizeSharedActivity("zpc-activity:v1:ref:"+HASH,{title:"hidden"}),null);
assert.equal(normalizeSharedActivity("zpc-activity:v1:processed:"+HASH,{title:"hidden"}),null);
assert.equal(normalizeSharedActivity("zpc-activity:v1:finance:123:"+HASH,{schema:"zevanory.activity.v1",title:"payment"}),null);
assert.equal(normalizeSharedActivity("zpc-activity:v1:event:123:x",{
  schema:"zevanory.activity.v1",type:"payment_confirmed",
  title:"sale",channel:"finance",status:"confirmed",refHash:HASH,
  sourceKey:"wrong",amountCents:3000,financialProof:"provider-get-verified"
}),null);
console.log("SHARED_ACTIVITY_17_TYPES=PASS");
console.log("SHARED_FINANCE_PROOF_AND_DEDUPE=PASS");
