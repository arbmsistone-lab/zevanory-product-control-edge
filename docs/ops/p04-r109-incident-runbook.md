# Runbook P04 | Contenção de aprovações autônomas e migração PIN → frase-senha (R109)
**Status:** CANDIDATO DRAFT. Nenhuma ação operacional autorizada por este documento.

## Resposta ao incidente
1. Preservar evidências de `creative-auto-decision` e status `disabled_manually`, commits anteriores e logs de GitHub. Não executar workflows para testar produção.
2. Conciliar as 24 aprovações e seis solicitações (HTTP 200) com IDs de criativos no painel, e os IDs de mídia no Meta Business Suite. Não presumir 24 posts; 03/11 09h01 BRT "Negócio Completo" está confirmado somente pelo registro do painel.
3. Proprietário decide separadamente manter/remover cada publicação. Não apagar, editar, aprovar ou publicar automaticamente.
4. O preço antigo "R$ 197" no script legado é um indício de fonte obsoleta. Não utilizar `data/products.json` como autoridade imutável; exigir Tabela C atual fornecida e validada pelo titular.
5. A certificação P04 exige verificação independente de mídia, legenda, hashes/certificado e validade, além da autorização expressa. Validação textual isolada deve retornar *revisão necessária*, não PASS de publicação.

## Operação candidata R109
- `.github/workflows/creative-auto-decision.yml`: apenas `workflow_dispatch` (sem cron), executa regressões locais sem segredo, rede, browser, Meta ou API. Mantê-lo desativado na configuração GitHub. Não usar mesmo após merge sem autorização individual.
- `scripts/creative-auto-decision.mjs`: utilitário de arquivos locais. Uso futuro autorizado: `node scripts/creative-auto-decision.mjs CAMINHO_TABELA_C.json CAMINHO_CANDIDATOS.json`. Não passar dados privados em linha de comando, apenas caminhos. Saída JSON é diagnóstico `READ_ONLY` com `publishable:false`, sem autenticação, HTTP ou mutação.
- `commercial-cleanup-ha-dry-run.yml`: YAML removido no PR; scripts históricos mantidos, portanto não há novo caminho de execução por Actions. Nunca repassar `ADMIN_PIN` a `target_url` arbitrária.
- `command-center-live-proof.yml`: YAML removido no PR; não substituir por teste em produção autenticado. Futuro teste apenas em laboratório isolado e sem writes persistentes.
- `ADMIN_PASSPHRASE` é exclusivamente segredo pessoal para autenticação humana, não credencial de automação.

## Gates de pré-merge e autenticação
1. Confirmar CI e diffs no **SHA exato**, especialmente busca de `ADMIN_PIN`, `ADMIN_PASSPHRASE`, endpoints que fazem writes, cron e arquivos remanescentes. Não reivindicar ausência de outras credenciais em arquivos não examinados.
2. Auditar R109 contra a Tabela C oficial e a política `cf-worker/p04-meta-policy.ts`; utilitário offline nunca atesta o certificado independente.
3. Verificar status dos três workflows via GitHub Actions em leitura: aposentados/disabled, sem novas execuções agendadas. A remoção do YAML de branch não modifica o estado GitHub até eventual merge.
4. No #217, não habilitar `ADMIN_AUTH_MODE=passphrase` até readback da migração R107, combinação frontend/Worker/Render, Cloudflare Access, credencial pessoal e rollback coordenado.
5. Se algum controle falhar, **NO-GO**. Preservar acesso humano independente e não reativar PIN para "consertar".

## Reversão de R109
- Se o utilitário offline apresentar regressões, interromper sua execução e restaurar apenas a branch/código via novo PR revisado; os workflows continuam desativados.
- Nunca restaurar a automação de aprovação ou o transporte do segredo como rollback. Qualquer reintrodução requer decisão nova do proprietário, auditoria e guardrail P04.

Referência: B3 adendo `docs/governance/B3-R109-P04.md` e R108 de 05/11/2026.
