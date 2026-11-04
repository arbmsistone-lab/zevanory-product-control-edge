# DEC-09 | Migração de PIN para frase-senha | NC-027
**Estado:** CANDIDATO em PR Draft #217. NÃO FAZER MERGE/DEPLOY antes dos gates. Nenhum segredo foi configurado.

## Implementação isolada
- Login público passa a solicitar frase-senha de 12 a 256 caracteres; não há filtragem numérica.
- Edge e origem reconhecem o modo explícito `ADMIN_AUTH_MODE=passphrase`. Nesse modo o antigo `ADMIN_PIN` e o hash portátil SHA-256 não são caminhos válidos de autenticação.
- A frase-senha é lida exclusivamente do segredo de runtime `ADMIN_PASSPHRASE`; `SESSION_SIGNING_KEY` com pelo menos 32 caracteres é exigido e usada para derivação protegida de fingerprint. Nunca escrever valores no GitHub, documentação ou logs.
- Backend preserva limite de cinco tentativas e bloqueio temporário progressivo no Edge. A segurança da contagem sob concorrência de requisições ainda precisa de teste independente/garantia transacional.
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

## Negação de serviço por bloqueio global de tentativas

O bucket global de cinco tentativas por minuto e o contador global após cinco erros permitem que desconhecidos provoquem bloqueio do proprietário. **NÃO HOMOLOGADO.** Proposta arquitetural a provar: proteção por IP/ASN e desafio adaptativo (Turnstile), limite agregado suficientemente alto para bloquear pulverização sem indisponibilizar o titular, monitoramento de anomalias e recuperação autenticada fora do endpoint público. Testar automação distribuída e concorrência real; não remover limite global sem substituto. O contrato mock de 12 requisições demonstra apenas integração, não atomicidade real.
