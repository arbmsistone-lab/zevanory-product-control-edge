# ZEVANORY PRODUCT CONTROL - Canonical Deployment Policy

## Canonical URL
https://control.zevanory.api.br/

## Permanent rule
1. The canonical user-facing URL MUST NOT change.
2. The canonical URL MUST be owned by ZEVANORY, never by a hosting provider.
3. All production UI updates MUST preserve https://control.zevanory.api.br/ as the single public entry point.
4. The canonical domain fronts a provider-independent routing layer. Current runtime priority:
   - Cloudflare Worker direct runtime
   - Render backend peer
   - Supabase portable store / direct backend data plane
   - Netlify/Vercel/other runtimes only as contingency origins
5. Provider URLs such as *.netlify.app, *.onrender.com, *.vercel.app or *.workers.dev are operational endpoints only and MUST NOT be presented as the canonical link.
6. Failure of any single provider MUST NOT change the canonical URL.
7. Never create a replacement public URL to bypass a provider outage.
8. Production closure requires the canonical domain to serve the intended exact release lineage and remain functional through at least one independent runtime path.

Current intended UI baseline:
- NO-SCROLL main Products screen
- ZEES-16
- 16 visible seals P01-P16
- PROVADO=green
- PARCIAL=amber
- BLOQUEADO=red
- N/A=neutral
- evidence-driven state only
- certification executor remains fail-closed
