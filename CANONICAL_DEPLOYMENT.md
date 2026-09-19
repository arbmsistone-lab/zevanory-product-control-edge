# ZEVANORY PRODUCT CONTROL - Canonical Deployment Policy

## Canonical URL
https://zevanory-product-control-backend.netlify.app/

## Permanent rule
1. The canonical user-facing URL MUST NOT change.
2. Every production UI update MUST target the existing Netlify site:
   - site name: zevanory-product-control-backend
   - site id: 56395604-d55a-4557-b223-c80fea6a05fa
3. Alternate runtimes (Cloudflare, Render, Vercel, Railway, Supabase or others) are contingency/failover only.
4. Alternate runtime URLs MUST NOT be presented as the canonical user-facing link.
5. If Netlify publication is temporarily blocked, keep the gate fail-closed and report the canonical URL as stale until the same site can be updated.
6. Never create a replacement Netlify project merely to bypass a deploy issue.
7. Production closure requires the canonical URL to serve the intended exact release lineage.

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
