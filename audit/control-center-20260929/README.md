# Control Center recovery candidate

Baseline source: `40086f5abc688850f29780ee01d2418b1ab7c286`.

Public readback proved Control Core `DENY`, ZEES 0 proven / 8 partial / 8 blocked, and ZEA-10 0 proven / 2 partial / 8 blocked. The static Trust snapshot and the backend bootstrap are different acquisition paths; this candidate stops treating a build snapshot as live authority.

Changes preserve the administrative token on transient failures, invalidate expired or incomplete Trust evidence, bind Core snapshot/decision identity, share one Core readback per bootstrap, and route API calls through the canonical same-origin provider router. Trust details replace the task surface. Product editing and CFO records use pagination.

The user's final rule prohibits both document and internal scrolling. The proposed internal-scroll recovery was removed before publication. The existing auditor retains its strict no-scroll assertions.

Local validation (synthetic fixtures, not production certification):

- Typecheck and full production build passed.
- Runtime-state contract passed (freshness, authority, 401 versus transient failures).
- Existing visual/accessibility auditor passed 124 states, four viewports and both themes.
- Extended auditor passed 65 viewport/reflow combinations; 13 nominal viewports, primary navigation, populated CFO pages and five product-form steps.
- The reflow cases model 80%, 90%, 100%, 110%, and 125% effective CSS viewports. They are not native browser zoom certification.
- npm dependency audit reported zero vulnerabilities at the observation time.

Production authentication was not established. The secure PIN submission returned `submission_failed`; the production page remained at login without a visible error. This branch is a draft recovery candidate. It has not been merged, deployed, or certified 10/10.

Remaining work includes authenticated production testing, expanded disclosures/adversarial data coverage, visual refinement, full product/Core evidence reconciliation, failover proof, deployment identity and production readback. No global completion or production PASS is asserted.
