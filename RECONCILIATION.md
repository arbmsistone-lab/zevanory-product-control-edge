# ZEVANORY PRODUCT CONTROL - Reconciliation Manifest

## Canonical entrypoint
https://controle.zevanory.api.br/

## Reconciled lineages
### AppDeploy legacy (v1-v43)
Preserved in current main:
- ZEES-16 governance model and 247 base controls
- fail-closed commercial gates
- telemetry retries and last-proven telemetry snapshot
- ARBM ONE kept separate from ZEVANORY ONE
- private telemetry refresh and evidence-driven certification
- PIN administration concepts migrated to portable hash/session model

Intentionally NOT restored:
- AppDeploy runtime dependency
- ADMIN_PIN plaintext/secret comparison flow
- obsolete legacy facade behavior
- older unaccented UI copy

### Netlify legacy UI
Preserved:
- portfolio/product control information architecture
- cards, filters, product actions and governance navigation
- canonical product list behavior

Superseded:
- stale upload-only deploy without commit_ref
- scrolling main Products view
- old certification counters without 16 visible state seals
- injected/floating Netlify attribution

### GitHub/Cloudflare/Render portable lineage
Canonical implementation includes:
- portable auth and session
- dual-store/portable Supabase path
- Render peer with Cloudflare direct fallback
- ZEES executor P01-P16
- evidence vault and certification runs
- release fingerprint invalidation
- evidence self-reference prevention
- batched evidence writes for edge limits
- 16 visible seals with PROVADO/PARCIAL/BLOQUEADO/N/A states
- NO-SCROLL main Products page
- independent Cloudflare runtime
- temporary migration/proof routes removed

## Visual baseline
- NO-SCROLL main Products screen
- 16 visible ZEES seals P01-P16
- PROVADO = green
- PARCIAL = amber
- BLOQUEADO = red
- N/A = neutral
- seal state must come from evidence, never manual coloring
- pagination instead of page-level scrolling
- no floating provider branding

## Runtime baseline
Single public entrypoint:
https://controle.zevanory.api.br/

Behind the entrypoint:
1. Cloudflare Worker direct runtime
2. Render backend peer
3. Supabase portable store/data plane
4. Netlify/Vercel/AppDeploy are non-canonical legacy/contingency origins only

## Fail-closed rule
No product is certified or sales-enabled unless all applicable ZEES pillars are PROVADO for the frozen release fingerprint.
