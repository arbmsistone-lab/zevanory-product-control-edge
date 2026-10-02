# ZEVANORY SALES — Product Charter

## Mission

ZEVANORY SALES is an isolated commercial product inside the ZEVANORY ecosystem.

Its purpose is to convert a configured offer into an auditable commercial operation that can progress from public discovery to paid customer and fulfillment, with autonomy increasing only when explicit safety and business gates are proven.

## Non-goals

- Do not replace the existing ZEVANORY Control Center.
- Do not create a second commercial engine when the current Commercial workspace can be extended.
- Do not reopen previously certified layout, deploy, DR, ZEES or platform work without contradictory evidence.
- Do not classify research, content generation, heartbeat or a prepared lead as a completed autonomous sale.

## Existing baseline to reuse

The current product-control runtime already contains:

- Commercial workspace
- Prospecting
- CRM / Sales
- Creatives
- Approval queue
- Publications
- Support
- Finance
- Evidence
- Commercial robot heartbeat
- Public prospect discovery
- Source-key deduplication
- Daily commercial briefs

The current robot deliberately keeps external execution behind explicit guards. The existing runtime records `no-auto-contact` and `no-auto-publish`. ZEVANORY SALES extends this core instead of bypassing it.

## Product levels

### SALES ASSIST

Human approval remains mandatory for external contact, offers and publication.

### SALES AUTOPILOT

Routine contact and follow-up may run automatically when channel, policy and evidence gates are ready. Sensitive commercial actions remain fail-closed.

### SALES AUTONOMOUS

The full commercial cycle may execute inside configured policies only when all required gates are proven.

## Canonical commercial cycle

```text
DISCOVERY
-> QUALIFICATION
-> CONTACT
-> CONVERSATION
-> OFFER
-> FOLLOW_UP
-> CHECKOUT
-> PAYMENT_CONFIRMED
-> CUSTOMER_CREATED
-> FULFILLMENT
```

## Final acceptance gate

`ZEVANORY_SALES_AUTONOMOUS=PASS` is allowed only when a real auditable run proves:

1. lead discovered;
2. external contact sent;
3. conversation observed;
4. qualification recorded;
5. offer sent;
6. follow-up executed or explicitly not required;
7. checkout completed;
8. payment confirmed;
9. customer record created;
10. fulfillment started.

Synthetic fixtures can prove code contracts but cannot satisfy the real-sale acceptance gate.

## Execution rules

- fail-closed by default;
- no external action without channel + policy + evidence readiness;
- preserve multiprovider, failover, recovery, portability and observability;
- all external actions must emit durable evidence;
- every automated decision must have an explainable reason;
- pricing and discount boundaries must be configurable;
- human override must remain available;
- production promotion is a separate gate from development completion;
- first end-to-end commercial proof should use ZEVANORY itself as the offer.

## Initial engineering slice

1. formal autonomy levels;
2. formal action gates;
3. formal real-sale proof gate;
4. contract tests;
5. integrate those gates into the existing commercial runtime;
6. only then add channel executors for contact, offer, checkout and fulfillment.
