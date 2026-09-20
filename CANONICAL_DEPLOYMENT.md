# ZEVANORY PRODUCT CONTROL - Canonical Deployment Policy

## Canonical URL
https://zevanory.api.br/control

## Permanent rule
1. The canonical user-facing URL MUST NOT change.
2. The canonical URL MUST be owned by ZEVANORY, never by a hosting provider.
3. All production UI updates MUST preserve https://zevanory.api.br/control as the single public entry point.
4. The canonical route fronts a provider-independent runtime layer:
   - Cloudflare Worker direct runtime
   - Render backend peer
   - Supabase portable store / direct data plane
   - Netlify/Vercel/AppDeploy are legacy or contingency origins only
5. Provider URLs such as *.netlify.app, *.onrender.com, *.vercel.app, *.workers.dev or AppDeploy URLs are operational endpoints only and MUST NOT be presented as the canonical link.
6. Failure of any single provider MUST NOT change the canonical URL.
7. Never create a replacement public URL to bypass a provider outage.
8. Production closure requires the canonical route to serve the intended exact release lineage and remain functional through at least one independent runtime path.

## Canonical UI baseline
- NO-SCROLL main Products screen
- ZEES-16
- 16 visible seals P01-P16
- PROVADO = green
- PARCIAL = amber
- BLOQUEADO = red
- N/A = neutral
- evidence-driven state only
- certification executor remains fail-closed
- provider branding must not float over the interface
- ARBM ONE and ZEVANORY ONE remain separate certification targets

## Automation rule
The main branch is the single source of truth.
A free GitHub Actions build validates the ZEES baseline and produces the canonical dist artifact for https://zevanory.api.br/control.
