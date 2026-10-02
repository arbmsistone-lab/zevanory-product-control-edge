import assert from 'node:assert/strict';
import {
  evaluateZevanoryAutonomousSaleProof,
  evaluateZevanorySalesAction,
  type ZevanorySalesPolicy,
} from '../src/zevanory-sales-model.ts';

const closed: ZevanorySalesPolicy = {
  infrastructureReady: false,
  channelReady: false,
  contactPolicyReady: false,
  publicationPolicyReady: false,
  pricingPolicyReady: false,
  checkoutReady: false,
  fulfillmentReady: false,
  paymentConfirmed: false,
  humanApproval: false,
  autonomousPublicationAllowed: false,
};

assert.deepEqual(
  evaluateZevanorySalesAction('autonomous', 'contact', closed),
  { allowed: false, reason: 'infrastructure_not_ready' },
  'autonomous mode must remain fail-closed when infrastructure is not ready',
);

const ready: ZevanorySalesPolicy = {
  infrastructureReady: true,
  channelReady: true,
  contactPolicyReady: true,
  publicationPolicyReady: true,
  pricingPolicyReady: true,
  checkoutReady: true,
  fulfillmentReady: true,
  paymentConfirmed: true,
  humanApproval: false,
  autonomousPublicationAllowed: false,
};

assert.deepEqual(
  evaluateZevanorySalesAction('assist', 'contact', ready),
  { allowed: false, reason: 'human_approval_required' },
  'assist mode must require human approval for external contact',
);

assert.deepEqual(
  evaluateZevanorySalesAction('autopilot', 'contact', ready),
  { allowed: true, reason: 'allowed' },
  'autopilot may contact only after infrastructure, channel and policy gates are ready',
);

assert.deepEqual(
  evaluateZevanorySalesAction('autonomous', 'publish', ready),
  { allowed: false, reason: 'autonomous_publication_not_allowed' },
  'publication must stay closed until autonomous publication is explicitly allowed',
);

assert.deepEqual(
  evaluateZevanorySalesAction('autonomous', 'fulfill', { ...ready, paymentConfirmed: false }),
  { allowed: false, reason: 'payment_not_confirmed' },
  'fulfillment must never run before payment confirmation',
);

const incompleteProof = evaluateZevanoryAutonomousSaleProof({
  leadDiscovered: true,
  contactSent: true,
  conversationObserved: true,
  qualificationRecorded: true,
  offerSent: true,
  followUpSatisfied: true,
  checkoutCompleted: true,
  paymentConfirmed: false,
  customerCreated: false,
  fulfillmentStarted: false,
});

assert.equal(incompleteProof.pass, false);
assert.deepEqual(incompleteProof.missing, [
  'paymentConfirmed',
  'customerCreated',
  'fulfillmentStarted',
]);

const completeProof = evaluateZevanoryAutonomousSaleProof({
  leadDiscovered: true,
  contactSent: true,
  conversationObserved: true,
  qualificationRecorded: true,
  offerSent: true,
  followUpSatisfied: true,
  checkoutCompleted: true,
  paymentConfirmed: true,
  customerCreated: true,
  fulfillmentStarted: true,
});

assert.equal(completeProof.pass, true);
assert.deepEqual(completeProof.missing, []);

console.log('ZEVANORY_SALES_MODEL_CONTRACT=PASS');
console.log('ZEVANORY_SALES_FAIL_CLOSED=PASS');
console.log('ZEVANORY_SALES_REAL_SALE_PROOF_GATE=PASS');
