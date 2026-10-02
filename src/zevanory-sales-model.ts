export type ZevanorySalesAutonomyLevel =
  | 'assist'
  | 'autopilot'
  | 'autonomous';

export type ZevanorySalesAction =
  | 'research'
  | 'contact'
  | 'publish'
  | 'offer'
  | 'follow-up'
  | 'checkout'
  | 'fulfill';

export type ZevanorySalesPolicy = {
  infrastructureReady: boolean;
  channelReady: boolean;
  contactPolicyReady: boolean;
  publicationPolicyReady: boolean;
  pricingPolicyReady: boolean;
  checkoutReady: boolean;
  fulfillmentReady: boolean;
  paymentConfirmed: boolean;
  humanApproval: boolean;
  autonomousPublicationAllowed: boolean;
};

export type ZevanorySalesActionDecision = {
  allowed: boolean;
  reason:
    | 'allowed'
    | 'infrastructure_not_ready'
    | 'channel_not_ready'
    | 'contact_policy_not_ready'
    | 'publication_policy_not_ready'
    | 'pricing_policy_not_ready'
    | 'checkout_not_ready'
    | 'fulfillment_not_ready'
    | 'payment_not_confirmed'
    | 'human_approval_required'
    | 'autonomous_publication_not_allowed';
};

function deny(reason: ZevanorySalesActionDecision['reason']): ZevanorySalesActionDecision {
  return { allowed: false, reason };
}

export function evaluateZevanorySalesAction(
  level: ZevanorySalesAutonomyLevel,
  action: ZevanorySalesAction,
  policy: ZevanorySalesPolicy,
): ZevanorySalesActionDecision {
  if (!policy.infrastructureReady) return deny('infrastructure_not_ready');

  if (action === 'research') return { allowed: true, reason: 'allowed' };

  if (!policy.channelReady) return deny('channel_not_ready');

  if (action === 'contact' || action === 'follow-up') {
    if (!policy.contactPolicyReady) return deny('contact_policy_not_ready');
    if (level === 'assist' && !policy.humanApproval) return deny('human_approval_required');
    return { allowed: true, reason: 'allowed' };
  }

  if (action === 'publish') {
    if (!policy.publicationPolicyReady) return deny('publication_policy_not_ready');
    if (level === 'assist' && !policy.humanApproval) return deny('human_approval_required');
    if (level !== 'assist' && !policy.autonomousPublicationAllowed && !policy.humanApproval) {
      return deny('autonomous_publication_not_allowed');
    }
    return { allowed: true, reason: 'allowed' };
  }

  if (action === 'offer') {
    if (!policy.pricingPolicyReady) return deny('pricing_policy_not_ready');
    if (level === 'assist' && !policy.humanApproval) return deny('human_approval_required');
    return { allowed: true, reason: 'allowed' };
  }

  if (action === 'checkout') {
    if (!policy.pricingPolicyReady) return deny('pricing_policy_not_ready');
    if (!policy.checkoutReady) return deny('checkout_not_ready');
    if (level === 'assist' && !policy.humanApproval) return deny('human_approval_required');
    return { allowed: true, reason: 'allowed' };
  }

  if (action === 'fulfill') {
    if (!policy.paymentConfirmed) return deny('payment_not_confirmed');
    if (!policy.fulfillmentReady) return deny('fulfillment_not_ready');
    return { allowed: true, reason: 'allowed' };
  }

  return deny('human_approval_required');
}

export type ZevanoryAutonomousSaleProof = {
  leadDiscovered: boolean;
  contactSent: boolean;
  conversationObserved: boolean;
  qualificationRecorded: boolean;
  offerSent: boolean;
  followUpSatisfied: boolean;
  checkoutCompleted: boolean;
  paymentConfirmed: boolean;
  customerCreated: boolean;
  fulfillmentStarted: boolean;
};

export type ZevanoryAutonomousSaleProofResult = {
  pass: boolean;
  missing: Array<keyof ZevanoryAutonomousSaleProof>;
};

export function evaluateZevanoryAutonomousSaleProof(
  proof: ZevanoryAutonomousSaleProof,
): ZevanoryAutonomousSaleProofResult {
  const required = Object.keys(proof) as Array<keyof ZevanoryAutonomousSaleProof>;
  const missing = required.filter(key => proof[key] !== true);
  return { pass: missing.length === 0, missing };
}
