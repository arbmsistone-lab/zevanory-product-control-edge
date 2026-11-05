# DEC-09 | Migração de PIN para frase-senha | NC-027
**Estado:** CANDIDATO em PR Draft #217. NÃO FAZER MERGE/DEPLOY antes dos gates. Nenhum segredo foi configurado.

## Implementação isolada
- Login público passa a solicitar frase-senha de 12 a 256 caracteres; não há filtragem numérica.
- Edge e origem reconhecem o modo explícito `ADMIN_AUTH_MODE=passphrase`. Nesse modo o antigo `ADMIN_PIN` e o hash portátil SHA-256 não são caminhos válidos de autenticação.
- A frase-senha é lida exclusivamente do segredo de runtime `ADMIN_PASSPHRASE`; `SESSION_SIGNING_KEY` com pelo menos 32 caracteres é exigido e usada para derivação protegida de fingerprint. Nunca escrever valores no GitHub, documentação ou logs.
- Backend preserva limite de cinco tentativas e bloqueio progressivo por origem (DEC-13(a)). NC01 introduz RPC PostgreSQL com serialização transacional por origem, exigindo migração separadamente autorizada e CI PostgreSQL 17 antes da publicação.
- Sessões antigas sem a marca `passphrase-v1` são recusadas após ativação. Sessões emitidas com a frase anterior são recusadas depois da rotação, por `authEpoch`.
- Migração legada do PIN portátil fica desabilitada quando o novo modo está ativo.
- `npm run test:passphrase-migration` cobre modo forte, segredo não configurado, PIN antigo negado, rotação e revogação; integra o comando `build`.

## Gates ANTES de qualquer publicação
1. Proprietário escolhe uma frase-senha **única, preferencialmente 20+ caracteres ou gerada por gerenciador** e cadastra no provedor de segredos autenticado, nunca por chat, PR ou arquivo de texto. Não cadastramos aqui.
2. Conferir `SESSION_SIGNING_KEY` forte (>=32 caracteres) e disponibilidade no Worker e na origem relevante.
3. Preparar `ADMIN_PASSPHRASE` e ativar `ADMIN_AUTH_MODE=passphrase` em processo de liberação autorizado, de modo coordenado com a versão do frontend; sem isso, o frontend novo não conseguirá autenticar. NÃO ativar modo ainda em produção.
4. CI integral / typecheck / build e testes do contrato da senha, validação negativa de 4 dígitos, lockout, concorrência, duas sessões, sessões antigas, rotação, renderização e sem rolagem. Qualquer vermelho = NO-GO.
5. Contra-auditoria independente Claude e autorização explícita de merge, deploy e troca de segredo. Rollback somente com plano formal sem reexpor PIN fraco em produção.
6. Readback após publicação autorizada, nunca com senha verdadeira em print ou log. Revogar sessões legadas e confirmar autenticação do titular.

**Bloqueios ainda não liberados:** migração PostgreSQL NC01 não aplicada aos ambientes reais; CI PostgreSQL 17 no SHA final e homologação end-to-end com provedor de segredos real ainda obrigatórios. A falta da RPC gera 503, nunca fallback ao lock anterior. Sem esses gates não declarar DEC-09 operacionalmente concluída.


## Corte coordenado obrigatório para impedir bloqueio do titular

A versão nova do frontend exige frase-senha de 12+ caracteres, enquanto o backend legado ainda espera PIN de 4 dígitos. **É proibido publicar somente o frontend ou somente o modo forte.**

1. Em laboratório isolado, montar a mesma combinação exata de build do frontend, Cloudflare Worker e origem; injetar segredo de TESTE, nunca a credencial real.
2. Exigir PR aprovado, CI integral no SHA exato, proteção do diagnóstico 403 em PIN e frase-senha, migração e revogação de sessões, teste de acesso móvel/desktop e plano de contingência por conta autenticada do provedor.
3. Antes da janela de implantação autorizada: validar que o proprietário acessa os controles de segredos/Cloudflare por autenticação independente do próprio painel. Guardar acesso de recuperação seguro e fora do painel.
4. Realizar **janela coordenada de publicação**: preparar o segredo forte sob autorização, implantar o Worker/origem compatível e frontend em uma operação controlada, ativar `ADMIN_AUTH_MODE=passphrase` somente com o frontend correspondente; bloquear acesso público temporariamente se a plataforma não oferecer corte atômico. Nenhuma fase intermediária pode expor uma tela incompatível com a credencial ativa.
5. Confirmar login do titular sem compartilhar a senha, acesso real a funções autorizadas, bloqueio do PIN antigo, fim de sessões antigas e resposta 403 anônima. Registrar apenas evidência redigida, sem senha.
6. Falha de qualquer gate = interromper e restaurar **combinação inteira e consistente** de frontend/backend e segredos, nunca reativar PIN fraco publicamente como atalho. O plano de reversão deve ser homologado antes, não improvisado durante incidente.

## DEC-13(a) | Anti-bloqueio do titular (substitui o bloqueio global no modo frase-senha)

**Problema corrigido:** o bucket `admin-passphrase-global` (5/min por colo) era consumido antes do bucket por IP e o backend mantinha um único registro `acs_pin_security` com bloqueio progressivo global; qualquer anônimo bloqueava o proprietário.

**Desenho implementado (somente `ADMIN_AUTH_MODE=passphrase`):**
1. **Identidade da origem:** apenas `CF-Connecting-IP` (definido pela Cloudflare). `X-Forwarded-For`, `X-Real-IP`, `True-Client-IP` nunca são lidos. IPv6 agrupado por /64; IPv4 mapeado em IPv6 vira o IPv4; ausente/inválido cai num único bucket `unattributed` (nunca em bypass). Código: `cf-worker/admin-auth-throttle.ts`.
2. **Limite por origem primeiro:** Worker consome `passphrase-src:<origem>` (5/min) antes de qualquer outro bucket.
3. **Sem bloqueio global:** o backend (`passphraseLogin` em `cf-worker/backend-index.ts`) delega a decisão inteira a `zpc_passphrase_attempt`, uma RPC em transação PostgreSQL com advisory lock por origem. Mantém registro `acs_passphrase_source_security`, id UUID derivado de SHA-256, com bloqueio 15/30/60/120 min. O bloqueio vale inclusive para a frase correta da mesma origem. O modo frase-senha não lê nem escreve `acs_pin_security`. A migração SQL é candidata, não aplicada em produção.
4. **Proteção distribuída sem bloquear o titular:** dois sinais agregados que **nunca rejeitam sozinhos**:
   - Worker: bucket `admin-passphrase-aggregate`; esgotado, origens sem dispositivo confiável pagam 2 fichas por tentativa (≈2/min por origem).
   - Backend: janela durável de 15 min (`acs_passphrase_aggregate_security`), incrementada dentro da mesma transação com advisory lock próprio; com ≥25 falhas, origens não confiáveis bloqueiam após 3 falhas (em vez de 5). Esse contador não causa bloqueio global.
   - **Dispositivo confiável:** cookie `__Host-zpc_td` (HttpOnly, Secure, SameSite=Strict, 30 dias), emitido somente após login bem-sucedido, HMAC com `SESSION_SIGNING_KEY` (separação de domínio). Só isenta do endurecimento agregado; não é fator de autenticação nem ignora o limite por origem.
5. **Fail closed:** limitador ausente ou com erro (inclusive no bucket agregado) e store indisponível => 503.

**Modo PIN legado inalterado em autenticação, após o filtro de host canônico:** o Worker retorna 403 em `POST /api/pin/login` quando `Host` difere de `controle.zevanory.api.br`, inclusive em `workers.dev` e URLs de prévia, ANTES de executar o limitador de qualquer modo. Na origem canônica, o PIN legado mantém `pin:<IP>` e o bloqueio global progressivo, intocados. O risco de DoS nesse modo permanece até o corte para frase-senha.

**Limites conhecidos:** a RPC NC01 é transacional apenas depois de aplicada em banco mediante autorização específica; o rate-limit da Cloudflare continua por colo e eventualmente consistente. Titular atrás do mesmo NAT/CGNAT de um atacante compartilha a origem e pode receber 429 dessa origem. Turnstile/ASN e recuperação independente do painel continuam evoluções. O registro de contador ainda precisa de verificação de replicação/DR para não perder estado numa troca de banco.

**Contratos:** `npm run test:passphrase-concurrent` (`scripts/passphrase-concurrent-attempts.ts`) cobre 12 origens simultâneas (nenhum 429 global), origem repetida, XFF falso ignorado, titular em origem limpa durante ataque distribuído, cookie confiável, fail-closed 503, modo PIN e **403 de host não canônico** (`workers.dev`/preview). O CI `postgres-atomic` (`scripts/passphrase-postgres-atomic.ts`) usa **PostgreSQL 17 real**, 24 requisições simultâneas na mesma origem, verificação de incremento agregado sem perdas, resistência a `public.hashtextextended` falsa, `pg_proc.proconfig` para os timeouts e **paridade das seis constantes** entre SQL e TypeScript. O teste Postgres não executa contra produção. Ambos precisam passar no mesmo SHA; o primeiro integra `build`.

## Rollback da RPC PostgreSQL (somente com autorização independente)

A função `public.zpc_passphrase_attempt(text, uuid, text, boolean, boolean)` é criada pela migração `supabase/migrations/20261104180000_dec13_atomic_passphrase_attempt.sql`. A migração `supabase/migrations/20261105150000_dec13_r107_clock_after_lock.sql` (R107) substitui a função: o relógio passa a ser lido depois de cada lock consultivo, e um `windowStart` no futuro não zera mais a contagem. Sem isso, transações concorrentes perdiam incrementos do agregado (reproduzido localmente em 8 de 15 rodadas com 40 conexões simultâneas; 0 de 30 após a correção). O rollback de **schema** exige uma mudança de banco autorizada e janela coordenada de frontend, Worker, modo de autenticação e segredos. **Não aplicar rollback isolado em produção**: o Worker em modo frase-senha passará a 503 (fail-closed) se a função não existir.

Com o tráfego administrativo temporariamente protegido e o plano de corte aprovado, o comando SQL de reversão é:

```sql
drop function if exists public.zpc_passphrase_attempt(text, uuid, text, boolean, boolean);
```

Este `DROP FUNCTION` **não apaga** `acs_passphrase_source_security` nem `acs_passphrase_aggregate_security` de `public.zpc_records`, para preservar trilhas de investigação. Exige avaliação de dependências, controle de acesso e procedimentos próprios para dados residuais. Recuperação funcional somente por versão compatível previamente validada; não reabrir PIN fraco como atalho.

### NC01 | Segurança transacional e alinhamento de políticas

A RPC `SECURITY DEFINER` fixa `search_path = pg_catalog, public`, qualifica `pg_catalog.pg_advisory_xact_lock` e `pg_catalog.hashtextextended` e fixa `lock_timeout = '2s'` e `statement_timeout = '2s'`, abaixo do timeout de 2,5s do Worker. Cancelamentos e falhas do banco resultam em 503 no Worker sem fallback. O contrato PostgreSQL 17 testa a tentativa de shadowing por `public.hashtextextended`, a configuração da função e concorrência.

As seis constantes da política TS (`SOURCE_MAX_FAILURES`, `SOURCE_MAX_FAILURES_UNDER_ATTACK`, `SOURCE_LOCK_MINUTES`, `SOURCE_LOCK_CAP_MINUTES`, `AGGREGATE_WINDOW_MINUTES`, `AGGREGATE_HOT_FAILURES`) permanecem duplicadas no SQL por exigência do código executado no banco; **a regressão `postgres-atomic` deve detectar qualquer divergência**. O workflow é acionado por mudanças em `supabase/migrations/**`, `cf-worker/admin-auth-throttle.ts` e os arquivos do contrato. O mecanismo e seus tempos precisam de teste pré-publicação em ambiente real isolado, sem executar migração no banco produtivo.

## NC02 | Inventário de caminhos de entrada e procedência do IP

| Entrada | Evidência de código/configuração | Situação e regra |
|---|---|---|
| `https://controle.zevanory.api.br/api/pin/login` | `cf-worker/wrangler.toml`, custom_domain; `cf-worker/worker.ts` força `edgeAuthPath` para backend Edge local | Caminho canônico, aplica `PIN_LIMITER` antes da RPC; `CF-Connecting-IP` só é confiável se entregue pela infraestrutura Cloudflare, não por um proxy arbitrário |
| `https://zevanory.api.br/control*` | Segunda rota declarada em `wrangler.toml`; redirecionamento 308 do domínio legado ao canônico no Worker | Não deve possuir rota de login paralela; verificar comportamento com requisição HTTP de leitura no readback autorizado |
| `*.workers.dev` / URL de prévia do mesmo Worker | `cf-worker/worker.ts` exige host canônico antes do login em qualquer modo; `scripts/passphrase-concurrent-attempts.ts` valida casos `workers.dev` e preview | **403 em POST `/api/pin/login` em host não canônico**, antes de autenticação. A configuração efetiva de `workers.dev`/previews na conta Cloudflare continua não verificada; eventuais outras rotas devem ser auditadas no readback |
| Render/origem `https://zevanory-product-control-edge.onrender.com` | `RENDER_BACKEND_URL` em `wrangler.toml`; `backend/index.ts` responde 404 em `POST /api/pin/login`, 403 no alias `/api/pin/login-origin-disabled` | Login direto negado em código, mas acesso público e regras de firewall do Render **não foram confirmados**. Testar host e caminhos de alias antes do corte |
| Backend Edge `cf-worker/backend-index.ts` | `POST /api/pin/login` é interno ao roteador Edge e recebe request encaminhado pelo Worker | Não publicar outro entrypoint que invoque `handler` sem filtro da borda. `CF-Connecting-IP` neste módulo depende do Worker externo ter preservado o cabeçalho da Cloudflare |
| Apps e hosts auxiliares | Não existe inventário autenticado de todos os domínios customizados, rotas de ambiente, previews e rotas Cloudflare ativadas | **PENDENTE** consultar configuração Cloudflare (routes, custom domains, workers.dev, previews), Render, DNS e testes reais de bloqueio de portas/aliases. Sem isso NC02 NÃO tem prova de topologia completa |

**Regra de segurança:** `X-Forwarded-For`, `X-Real-IP`, `True-Client-IP` não entram na identidade do limitador. `CF-Connecting-IP` deve ser inserido/substituído pela borda Cloudflare e nunca aceito de requisição encaminhada de origem não confiável. Em rotas internas, preservar a identidade da requisição original somente após validar que ela veio da própria borda. Uma rota fora desse caminho deve ser bloqueada, não deve escolher um IP fornecido pelo cliente. Não declarar NC02 PASS até verificar a configuração real do provedor.

## NC03 | Cookie copiado, revogação e ameaças

O cookie `__Host-zpc_td` autentica **apenas o status de dispositivo confiável para a política de limitação**. Não autentica login, não emite sessão e não salta o bucket por origem. Ele é HttpOnly, Secure, SameSite=Strict, HMAC assinado, expira em 30 dias e usa domínio separado da chave de assinatura da sessão.

**Cenário de roubo/replay:** se um atacante copiar o cookie íntegro de um navegador comprometido, pode reutilizá-lo em outra origem/IP para escapar da penalidade de pressão agregada. Ele ainda precisa conhecer a frase-senha e continua sujeito a `passphrase-src` e ao bloqueio durável daquela origem. Cookies adulterados, expirados ou assinados com outra chave são rejeitados, mas isso **não** impede replay de um cookie válido. O teste atual verifica falsificação e não prova resistência a replay.

**Mitigação operacional:** tratar vazamento de cookie como incidente, invalidar dispositivos confiáveis por rotação coordenada da `SESSION_SIGNING_KEY` (isso também afeta sessões: planejamento obrigatório) ou futura revogação individual persistente. Não usar IP fixo como prova de posse do dispositivo, porque redes móveis mudam. Registrar monitoramento de tentativas por origem, flags de anomalia e recuperação fora do painel.

## NC04 | Prova regressiva contra código antigo (proveniência)

Em 04/11/2026, Claude relatou execução do contrato novo contra implementação anterior: falhou no critério `per-source before aggregate`; ao restaurar lock global, o lote de 12 origens teve 4 respostas 401 e 8 respostas 429. **Resultado relatado pelo Claude, não reproduzido independentemente pelo GPT-6 nesta execução.** Não confundir com 12 checks verdes na implementação candidata.

## Histórico: negação de serviço por bloqueio global (estado SUPERADO em código candidato, não em produção)

O código antigo possuía bucket global de cinco tentativas/minuto consumido antes do bucket por IP e lock global no backend. A DEC-13(a) **corrigiu essa arquitetura no candidato em Draft**, substituindo-a por quota e lock por origem e sinal agregado que não bloqueia sozinho. Isso NÃO significa mudança já implantada, nem elimina as ressalvas de NAT compartilhado, confiança no cabeçalho e migração da RPC. A implementação antiga permanece operando onde a versão candidata não foi publicada. **NÃO HOMOLOGADO PARA PRODUÇÃO até NC01/NC02, CI e corte coordenado serem comprovados.**
