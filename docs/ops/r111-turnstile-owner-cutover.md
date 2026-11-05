# R111 / DEC-18 | Turnstile no login do painel (CANDIDATO, sem deploy)

**Governança:** vendas permanecem fechadas. Cloudflare Access não foi ativado porque exige pagamento/cadastro de meio de pagamento. Nada neste PR autoriza editar secrets, publicar Worker ou ativar firewall. Uma frase-senha real nunca entra no Git, no GitHub Actions ou nos logs.

## Contrato
- O único login administrativo é POST `https://controle.zevanory.api.br/api/pin/login`, mesmo no modo frase-senha (rota legada mantida por compatibilidade). Hosts alternativos são barrados pelo Worker.
- `cf-worker/admin-turnstile.ts` consulta `https://challenges.cloudflare.com/turnstile/v0/siteverify` com `application/x-www-form-urlencoded`, a credencial `TURNSTILE_SECRET` mantida pelo proprietário, o token de uso único e, se válido, `CF-Connecting-IP` (nunca X-Forwarded-For).
- Com `TURNSTILE_ENFORCED=true`, a validação ocorre **antes** de `PIN_LIMITER` e da RPC/frase-senha. Token vazio/inválido, origem ou `action` incorretas: HTTP 403. Secret/sitekey ausente, timeout/indisponibilidade do Siteverify: HTTP 503, sem bypass.
- Não há sessão administrativa quando o Turnstile é aprovado. A frase-senha, os locks por origem, a revogação e as verificações anteriores continuam obrigatórias.
- Um token só pode ser resgatado uma vez e expira em 300 segundos, segundo a Cloudflare. O servidor valida toda tentativa; o browser limpa e pede novo token após tentativa de login.
- `GET /api/auth/turnstile-config` retorna apenas sitekey pública e estado de ativação, **nunca secret**. A página `/certifier` tem o mesmo desafio; não há exceção por cliente.
- Uma ativação de produção deve ser **coordenada**: o candidato só passa a exigir o desafio quando o proprietário configurar os bindings e mudar `TURNSTILE_ENFORCED` em publicação autorizada. O modo desligado serve apenas para preparar a versão; não equivale à proteção ativada.

## Criação gratuita do widget pelo proprietário
1. No painel Cloudflare, abrir **Turnstile → Add widget**, escolher nome exclusivo `ZEVANORY Control Owner Login`, incluir o hostname exato `controle.zevanory.api.br` (sem URL/path), escolher **Managed**; conferir plano e custo zero antes de salvar.
2. Copiar apenas a **sitekey pública** para o runtime como `TURNSTILE_SITE_KEY` (não precisa mandar ao Claude/GPT-6). A **secret key** deve ser cadastrada diretamente como segredo `TURNSTILE_SECRET` no Worker `zevanory-product-control-portable`, pelo próprio proprietário e sem print/colar em chat.
3. Preparar ambos os bindings sem ativar o desafio. Verificar por **nomes apenas**, nunca valores. Não retirar `ADMIN_AUTH_MODE`, `ADMIN_PASSPHRASE`, `SESSION_SIGNING_KEY` nem limites.
4. Em sandbox sem credenciais reais, testar `TURNSTILE_ENFORCED=true` com o widget permitido, ação `zpc_owner_login`, hostname canônico, rejeição sem token (403), rejeição de replay/expiração e ausência de consumo de PIN_LIMITER em falhas.
5. Durante a janela guiada e **somente após autorização específica**, implantar código e frontend compatíveis e ativar `TURNSTILE_ENFORCED=true`. Confirmar primeiro que o proprietário consegue concluir o desafio; caso contrário **NO-GO**, restaurar combinação consistente sem mudar frase-senha.
6. Readbacks: `GET /api/auth/turnstile-config` retorna enabled=true/sitekey pública; login sem token 403; login com desafio válido e frase-senha correta cria sessão; frase errada nunca cria sessão; diagnóstico 403; PIN de quatro dígitos inaceitável; logs sem token ou segredo.

## Recuperação e limites
- Se o widget ou Siteverify falhar, o login fica indisponível por projeto (503). Recuperação sob identidade Cloudflare independente do painel: restaurar versão e bindings aprovados ou desativar proteção **somente com autorização expressa**, preservando frase-senha e guardrails. Não restaurar PIN.
- CAPTCHA não substitui a senha, nem a limitação por origem, e pode falhar em redes/ad-blockers; validar acessibilidade e telas de celular, sem rolagem.
- Script externo do widget precisa ser permitido na política CSP. O login React utiliza renderização explícita; a rota de certificação também carrega o widget.
- O booleano `TURNSTILE_ENFORCED` deve estar sob controle humano. Não instruir nenhum workflow automático a configurá-lo ou a usar `ADMIN_PASSPHRASE`.
- Testes `npm run test:admin-turnstile`, `npm run build`, `npm run typecheck` no SHA exato. CI green e auditoria Claude exigidos antes de merge.
- Fontes: https://developers.cloudflare.com/turnstile/get-started/ e https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

**Estado:** APENAS PROPOSTA. Sem criar widget, secrets, deploy, merge, WAF ou Access.
