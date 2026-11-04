# DEC-09 | Migração de PIN para frase-senha | NC-027
**Estado:** CANDIDATO em PR Draft #217. NÃO FAZER MERGE/DEPLOY antes dos gates. Nenhum segredo foi configurado.

## Implementação isolada
- Login público passa a solicitar frase-senha de 12 a 256 caracteres; não há filtragem numérica.
- Edge e origem reconhecem o modo explícito `ADMIN_AUTH_MODE=passphrase`. Nesse modo o antigo `ADMIN_PIN` e o hash portátil SHA-256 não são caminhos válidos de autenticação.
- A frase-senha é lida exclusivamente do segredo de runtime `ADMIN_PASSPHRASE`; `SESSION_SIGNING_KEY` com pelo menos 32 caracteres é exigido e usada para derivação protegida de fingerprint. Nunca escrever valores no GitHub, documentação ou logs.
- Backend preserva limite de cinco tentativas e bloqueio temporário progressivo no Edge, por origem (DEC-13(a)). A segurança da contagem sob concorrência de requisições ainda precisa de teste independente/garantia transacional.
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

**Bloqueios não resolvidos aqui:** testes de concorrência do bloqueio de tentativas e homologação end-to-end com o provedor de segredos real. Sem esses gates não declarar DEC-09 operacionalmente concluída.


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
3. **Sem bloqueio global:** o backend (`passphraseLogin` em `cf-worker/backend-index.ts`) mantém um registro durável por origem (`acs_passphrase_source_security`, id UUID derivado de SHA-256; o IP não é gravado) com bloqueio progressivo 15/30/60/120 min. O bloqueio vale para qualquer tentativa daquela origem, inclusive a frase correta. O registro global `acs_pin_security` não é lido nem escrito nesse modo.
4. **Proteção distribuída sem bloquear o titular:** dois sinais agregados que **nunca rejeitam sozinhos**:
   - Worker: bucket `admin-passphrase-aggregate`; esgotado, origens sem dispositivo confiável pagam 2 fichas por tentativa (≈2/min por origem).
   - Backend: janela durável de 15 min (`acs_passphrase_aggregate_security`); com ≥25 falhas, origens não confiáveis bloqueiam após 3 falhas (em vez de 5).
   - **Dispositivo confiável:** cookie `__Host-zpc_td` (HttpOnly, Secure, SameSite=Strict, 30 dias), emitido somente após login bem-sucedido, HMAC com `SESSION_SIGNING_KEY` (separação de domínio). Só isenta do endurecimento agregado; não é fator de autenticação nem ignora o limite por origem.
5. **Fail closed:** limitador ausente ou com erro (inclusive no bucket agregado) e store indisponível => 503.

**Modo PIN legado inalterado** (por IP `pin:<IP>` + bloqueio global progressivo): um espaço de 4 dígitos não sobrevive a ataque distribuído só com limite por origem. O risco de DoS do titular nesse modo permanece até o corte para frase-senha.

**Limites conhecidos:** o contador agregado durável é read-modify-write com perdas sob concorrência (é só sinal); o incremento por origem também, limitado pelo bucket de 5/min no edge. O rate-limit da Cloudflare é por colo e eventualmente consistente. Titular atrás do mesmo NAT/CGNAT do atacante compartilha a origem. Turnstile/ASN e recuperação fora do endpoint público continuam como evolução.

**Contrato:** `npm run test:passphrase-concurrent` (`scripts/passphrase-concurrent-attempts.ts`): 12 origens simultâneas avaliadas (nenhum 429 global), origem repetida bloqueada (edge e durável), XFF falso ignorado, login do titular por origem limpa durante ataque distribuído contínuo, isenção por dispositivo confiável, 4 casos de fail-closed 503 e modo PIN inalterado. Integra `build`.

## Histórico: negação de serviço por bloqueio global de tentativas (resolvido por DEC-13(a) no modo frase-senha)


O bucket global de cinco tentativas por minuto e o contador global após cinco erros permitem que desconhecidos provoquem bloqueio do proprietário. **NÃO HOMOLOGADO.** Proposta arquitetural a provar: proteção por IP/ASN e desafio adaptativo (Turnstile), limite agregado suficientemente alto para bloquear pulverização sem indisponibilizar o titular, monitoramento de anomalias e recuperação autenticada fora do endpoint público. Testar automação distribuída e concorrência real; não remover limite global sem substituto. O contrato mock de 12 requisições demonstra apenas integração, não atomicidade real.
