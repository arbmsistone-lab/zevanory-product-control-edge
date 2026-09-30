# Pre-publication verification

BASE_SHA=40086f5abc688850f29780ee01d2418b1ab7c286
SOURCE_SHA=40086f5abc688850f29780ee01d2418b1ab7c286
PACKAGE_SHA256=481bf16e540edc325681c3a169d271d2709e0b00946a30756382443f4e6cd4ee
PRODUCTION_CHANGED=false
CURRENT_CANONICAL_RUNTIME_UNCHANGED=true
RELEASE_APPROVED=false

The authorized ZIP was safely extracted (102 entries; no absolute paths or parent traversal). All 14 changed source files matched the staged candidate byte for byte. Additional files in this commit contain this verification and the repeated local audit results. The full diff is against the BASE_SHA above and is available in the PR.

## Executed tests

- npm run typecheck: PASS
- node --import tsx scripts/runtime-state-contract.ts: PASS
- npm run build: PASS, including runtime dependency audit, commercial audit/contracts and CFO audit/contracts
- python3 scripts/ped_versal_zero_debt_audit.py: PASS
- node scripts/canonical-origin-audit.mjs: PASS
- node scripts/control-center-truth-runtime.mjs: PASS, 65 effective viewport/reflow cases, 13 nominal viewports with primary areas, populated CFO pagination, five product-editor pages, transient session errors, 401 and stale evidence
- node scripts/control-center-ped-runtime.mjs: PASS, 124 synthetic states, four viewports, both themes, accessibility/contrast/focus/layout assertions
- npm audit --json: PASS, zero reported vulnerabilities
- git diff --cached --check: PASS

NO_GLOBAL_SCROLL=PASS
NO_INTERNAL_SCROLL=PASS

These two PASS fields describe only the tested local synthetic states. Global geometry, visible scrollable descendants and selected action/dialog bounds were checked. They do not certify every data value, disclosure, native browser zoom or authenticated production state. Clipping or hiding unreachable content is not accepted as a solution. Expanded product disclosures and adversarial long data remain a promotion blocker. The mandatory rule forbids all horizontal and vertical scrolling globally and internally.

## Security scan

SECRET_PATTERN_SCAN=PASS: 102 extracted entries inspected for private keys, GitHub tokens, AWS keys, JWTs and credential-bearing URLs. Sensitive filenames and literal credential assignments were also reviewed; no credentials were identified. Initial URL matches in public JSON-LD were reviewed and rejected as false positives. Synthetic session placeholders are test fixtures. This targeted scan and dependency audit are not a full security certification.

## Known blockers

- Expanded disclosures, long-input fields and adversarial data require broader no-scroll and reachability proof.
- The runtime task surface is not yet covered by the complete responsive/theme audit matrix.
- Effective CSS viewport reflows do not prove native browser zoom behavior.
- Production PIN authentication was not established; functional and provider/failover proof remain pending.
- Public Core readback is DENY with incomplete ZEES/ZEA evidence; the frontend cannot approve missing backend evidence.
- Visual certification, performance proof and deployment lineage/readback remain pending.
- Vite emits an existing maxParallelFileOps option warning.

Only a work branch and draft PR are authorized. No merge, main write, deployment, canonical promotion, history rewrite, force push or gate bypass is authorized. Existing deployment workflow is scoped to main; the new workflow performs tests and uploads audit artifacts only.
