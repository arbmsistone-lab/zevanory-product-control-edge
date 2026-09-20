# ZEVANORY PRODUCT CONTROL - Canonical Deployment Policy

## Canonical URL
https://controle.zevanory.api.br/

## Permanent rule
1. The canonical user-facing URL MUST NOT change.
2. The canonical URL MUST be owned by ZEVANORY, never by a hosting provider.
3. All production UI updates MUST preserve https://controle.zevanory.api.br/ as the single public entry point.
4. The canonical domain fronts a provider-independent runtime layer:
   - Cloudflare Worker direct runtime
   - Render backend peer
   - Supabase portable store / direct data plane
   - Deno/global trust peers where applicable
   - Netlify/Vercel/AppDeploy are legacy or contingency origins only
5. Provider URLs are operational endpoints only and MUST NOT be presented as the canonical link.
6. Failure of any single backend/provider MUST NOT change the canonical URL.
7. Production closure requires the canonical domain to serve the exact intended release lineage.

## Canonical UI baseline
- NO-SCROLL main Products screen
- ZEES-16 with 16 visible seals P01-P16
- PROVADO = green; PARCIAL = amber; BLOQUEADO = red; N/A = neutral
- evidence-driven state only
- live Trust Chain / quorum / ZEA-10 / SHA / engines
- no provider branding
- certification executor fail-closed
- ARBM ONE and ZEVANORY ONE remain separate targets

## Automation rule
The main branch is the single source of truth. Every relevant push must pass the free GitHub Actions canonical build gate before production promotion.
