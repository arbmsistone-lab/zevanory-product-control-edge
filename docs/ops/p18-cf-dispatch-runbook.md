# P18 | Gatilho externo pela Cloudflare: runbook, passos do proprietário e ensaios

AVAL Sol 253/254. O agendador do GitHub está estrangulado em `arbmsistone-lab/zevanory-public-mirror`: o monitor P18
(`p18-external-monitor.yml`, cron `2-59/5`) não rodou nenhuma vez desde a ativação (15:29 UTC, 25/10). Um workflow `*/15`
do mesmo repositório rodou só às 01:25, 06:26 e 11:52 UTC. Por isso o cron **existente** deste Worker de controle passa a
pedir `workflow_dispatch` do monitor a cada 5 min. O agendador do GitHub continua como caminho extra, de melhor esforço.
Nada aqui resolve o R4 nem declara conformidade com as seções 9 ou 11 do Roteiro. Um disparo feito pelo mesmo cron da
Cloudflare seria apenas reforço do caminho primário: ele também para numa queda total da Cloudflare. A segunda via
independente continua pendente de decisão do Sol e do proprietário; as opções estão em
[`p18-segunda-via-independente.md`](./p18-segunda-via-independente.md).

## 1. O que roda, e onde

| Caminho | Onde roda | O que faz | Detecta |
|---|---|---|---|
| Pedido por janela | Cron do Worker `zevanory-product-control-portable` (`*/5`) | `POST .../actions/workflows/p18-external-monitor.yml/dispatches` com `ref=gh-pages`, `inputs.window_id=p18w-AAAAMMDDTHHMMZ` (janela de 5 min de `controller.scheduledTime`), `dispatched_at`, `dispatch_source=cloudflare-cron`, `return_run_details=true` | Token inválido, sem permissão, limite, GitHub fora do ar, timeout |
| Contingência executável | Mesmo cron | `GET` público de `raw.githubusercontent.com/.../evidence/b0-baseline/p18/heartbeat.json`. Batimento ausente, malformado ou com mais de 15 min gera alerta, **mesmo que o pedido tenha voltado 200/204** | Runner que não iniciou, monitor falhando, push de evidência falhando |
| Monitor | Runner do GitHub (Azure) | Sonda as páginas de venda e grava `runs-*.jsonl` (início real, `window_id`, `dispatch_to_start_s`), `heartbeat.json` e `cf-dispatch.json` | Vendas fora do ar (issue `[P18]`) |
| Vigia | Runner do GitHub (schedule) | Lê `heartbeat.json` e `cf-dispatch.json`. O caminho Cloudflare só fica **ativo** com `vars.P18_CF_DISPATCH_EXPECTED=true` **e** uma 1ª prova válida (ver seção 1.1). Ativo, mais de 15 min sem início pedido pela Cloudflare (ou documento quebrado) abre a issue `[P18-VIGIA] Gatilho Cloudflare parado` | **Cloudflare inteira parada**, quando o GitHub roda o vigia |

### 1.1 Estados do vigia do caminho Cloudflare (Ordens Sol 259–263)

O `cf-dispatch.json` é avaliado em três níveis: (1) o documento existe (senão `MISSING`; erro de leitura = `UNREADABLE`);
(2) a estrutura é válida (senão `MALFORMED`); (3) há **prova coerente** de uma execução pedida pela Cloudflare que
iniciou: `run_id` numérico, `window_id` válido, `dispatched_at` e `started_at` ISO, início da janela ≤ `dispatched_at` ≤
`started_at`, `dispatch_to_start_s` coerente e início não no futuro (senão `INVALID_PROOF` ou `FUTURE`). Só `FRESH` e
`STALE` são prova válida. O monitor grava a 1ª prova válida no batimento (`cf_first_proof_at`) e a leva adiante.

| Estado do vigia | Quando | Efeito |
|---|---|---|
| `NOT_EXPECTED` | `P18_CF_DISPATCH_EXPECTED` diferente de `true` | Só registra no log |
| `AWAITING_FIRST_PROOF` | Variável `true`, mas ainda sem prova válida (nem `cf-dispatch.json` válido agora, nem `cf_first_proof_at` no batimento) | Registra. Se o documento existir mas for `MALFORMED`, `UNREADABLE`, `INVALID_PROOF` ou `FUTURE`, emite o aviso **não paginante** `::warning P18_WATCHDOG_CF_PENDING`: sem issue e sem falhar o job. Ausência simples (`MISSING`) não gera aviso |
| `ACTIVE` | Variável `true` **e** prova válida (agora ou `cf_first_proof_at`) | Mais de 15 min sem início pedido pela Cloudflare, ou documento ausente, quebrado, ilegível ou incoerente, abre ou atualiza a issue `[P18-VIGIA] Gatilho Cloudflare parado` e falha o job. A issue fecha quando volta a haver prova `FRESH` |

Os dois caminhos se cobrem. A Cloudflare lê o batimento do GitHub, e o GitHub lê o batimento da Cloudflare. Uma queda
completa da Cloudflare **não** é vista pelo Worker. Quem a detecta são as execuções do GitHub, e só quando o GitHub roda.

## 2. As 5 propriedades do Sol

1. **Idempotência.** O id de janela vem de `scheduledTime` (determinístico por janela). No GitHub, o grupo de
   concorrência `p18-external-monitor` (`cancel-in-progress: false`, sem `queue: max`) permite no máximo 1 execução
   rodando e 1 pendente. Uma nova pendente cancela a anterior ([GitHub: Control workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)).
   O monitor grava `window_id` e `start_window_id`. Janela já sondada vira `duplicate_window`: não sonda, não alerta e
   não grava batimento. O agendador cai na mesma janela (o slot `:02` pertence à janela `:00`). Um id pedido fora de
   [-60 min, +2 min] é descartado, e um id forjado não suprime janela futura.
2. **Pedido verificável.** O Worker registra HTTP, desfecho, `workflow_run_id` (quando há 200) e duração, numa linha
   `p18_ext_trigger` por janela e no estado `p18-ext:v1:state` do KV. O GitHub registra o início real do runner e
   `dispatch_to_start_s`. **HTTP 204/200 não significa "monitorado".** Isso só vale com o batimento fresco, que a
   contingência confere.
3. **Fail-safe.** 401, 403, 404, 422, 429, 5xx, timeout, rede, ou batimento velho, ausente ou ilegível, gravam o estado e
   um alerta `zpc-alert:v1:*` com `category: "channel_down"` no KV compartilhado (mesmo namespace `728a…` do Worker
   central). O cron horário do Worker central envia isso como resumo por e-mail, pela conta Resend existente
   (`worker/owner-alerts.mjs`). Não há provedor nem conta nova. Se a leitura do KV falhar, nada é gravado (sem
   tempestade de alertas). Só o log registra a falha.
4. **Credencial mínima.** Token fine-grained com **apenas Actions: read and write**, somente neste repositório
   (Metadata: read é obrigatório e automático), com validade de 90 dias ou menos. Fica guardado como segredo do Worker
   `P18_DISPATCH_TOKEN`. Claude nunca vê o valor (seção 4).
5. **Prova operacional.** Ensaios na seção 5. O que é testável no CI está em `scripts/p18-dispatch.test.ts` (16 testes)
   e `scripts/p18-dispatch.mutants.mjs` (16 mutantes, todos KILLED), no gate `p18-dispatch-gate.yml`, e no lado mirror
   (`tests/b0-baseline.test.mjs` com 24 testes e 33 mutantes).

## 3. Orçamento por invocação (Workers Free)

| Recurso | Limite Free ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [KV limits](https://developers.cloudflare.com/kv/platform/limits/)) | P18 por invocação |
|---|---|---|
| CPU | 10 ms por Cron Trigger | valor medido e impresso por `P18_CPU_PER_INVOCATION_MS` no gate com rede/KV falsos; registrar o número real de cada execução. O ensaio local não substitui p50/p99 no workerd (R7) |
| Subrequisições | 50 | **no máximo 2** (pedido + batimento), com teto rígido no código. Sem retentativa: a próxima janela é a retentativa |
| Conexões simultâneas | 6 | 2, em paralelo. As tarefas antigas rodam em sequência (no máximo 1 conexão) |
| Operações KV | 1000 | 1 leitura + até 2 gravações |
| Gravações KV/dia (conta, compartilhado) | 1000 | nominal 24/dia (checkpoint horário). Teto rígido de 6 por hora (144/dia) mesmo com as duas verificações oscilando |
| Tempo de parede | 15 min por cron | orçamento de 10 s: pedido 8 s e batimento 5 s, com timer próprio que vale mesmo se a dependência ignorar o abort |
| Cron Triggers | 5 por conta | **nenhum novo**: o mesmo trigger passa de `*/15` para `*/5`. A conta continua com 4 (3 do central + 1 deste) |
| Workers Logs | sujeito aos limites do plano | habilitado com `head_sampling_rate = 0.05`. A amostra reduz metadados de requisição retidos; não é canal de alerta nem prova de cobertura integral |

As tarefas antigas (robô comercial, publicador Meta, atividade compartilhada) continuam só nos minutos 0, 15, 30 e 45
(`isLegacyDutyMinute`). Nesses minutos o P18 roda no próprio `ctx.waitUntil` e não é aguardado por elas. O teste S1 e o
mutante M09 provam isso com o `scheduled()` real e a rede do P18 travada.
O teste de configuração usa `tomllib`, não correspondência textual: prova que o TOML é válido, que `routes` continua
como array no nível raiz e que a amostragem está configurada. A linha estruturada `p18_ext_trigger` contém somente
janela, códigos/estados HTTP, identificadores de execução, idades/durações, contagens e estado do KV. Não contém token,
headers, corpo da requisição, e-mail ou conteúdo de vendas. Outros `console.*` e metadados de invocação já existentes
no Worker também podem entrar na amostra; por isso a taxa não é 100% e o acesso aos logs deve seguir o acesso ao Worker.

## 4. Passos do proprietário, em ordem

1. **Revisar e fazer o merge do PR do mirror** (monitor aceita `workflow_dispatch` com `window_id`). Precisa vir
   primeiro: sem os inputs, o GitHub responderia 422 ao pedido.
2. **Criar o token** ([GitHub: managing personal access tokens](https://docs.github.com/en/enterprise-server@3.15/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)):
   foto do perfil → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** →
   **Generate new token**.
   - Token name: `zevanory-p18-cf-dispatch`. Description: `Cloudflare cron -> workflow_dispatch do P18`.
   - Expiration: **Custom**, no máximo 90 dias (anotar a data e criar um lembrete para o dia 80).
   - Resource owner: `arbmsistone-lab`.
   - Repository access: **Only select repositories** → `arbmsistone-lab/zevanory-public-mirror`.
   - Permissions → Repository permissions → **Actions: Read and write**. Mais nada (Metadata: Read-only entra
     sozinho). Nada de Contents, Secrets, Administration, Workflows nem outros repositórios.
   - **Generate token**. O valor aparece uma vez e vai direto para o passo 3, sem passar por chat, arquivo ou print.
3. **Guardar o token como segredo do Worker** (só o proprietário). Cloudflare → **Workers & Pages** →
   `zevanory-product-control-portable` → **Settings** → **Variables and Secrets** → **Add** → Type **Secret** → Name
   `P18_DISPATCH_TOKEN` → colar → **Deploy**. Também dá para usar a CLI:
   `npx wrangler secret put P18_DISPATCH_TOKEN --name zevanory-product-control-portable`. O valor é pedido no prompt e
   não aparece na tela. Salvar o segredo cria uma versão do código **atual**, que ainda não usa o segredo e por isso fica inerte.
4. **Fazer o merge do PR do control-edge e autorizar o deploy.** O reconciliador agendado do mirror
   (`t2-exact-control-worker-promotion.yml`) está pausado por `vars.ZPC_ROLLBACK_HOLD`. A execução das 15:16 UTC de
   25/10 anotou "reconciler paused". Portanto o merge **não** pede publicação. O deploy só acontece com a autorização do
   proprietário: pelo publicador canônico (`zpc-control-worker-deploy.yml`, Environment protegido) ou ao liberar a
   trava, o que publicaria todo o `main` à frente da produção. A mudança do cron leva até 15 min para propagar.
5. **Conferir.** Antes da primeira janela após o deploy, iniciar `npx wrangler tail zevanory-product-control-portable
   --format json` e salvar a sessão completa da janela. A linha `p18_ext_trigger` no **tail em tempo real**
   deve mostrar `dispatch.outcome=accepted` e um `run_id`. No GitHub deve aparecer a execução
   `P18 monitor p18w-…` com `event=workflow_dispatch`. Em seguida, `p18/heartbeat.json` e `p18/cf-dispatch.json` devem
   existir no ramo `evidence/b0-baseline`. O primeiro alerta "batimento inexistente", se chegar antes da primeira
   execução terminar, é esperado e serve como ensaio R0 do canal.
6. **Ligar o vigia do caminho Cloudflare.** GitHub → repositório → **Settings** → **Secrets and variables** →
   **Actions** → **Variables** → `P18_CF_DISPATCH_EXPECTED` = `true`. Ligar a variável não ativa o alerta sozinha: o
   vigia fica em `AWAITING_FIRST_PROOF` até existir a 1ª prova válida (seção 1.1). Antes disso, documento quebrado gera
   só o aviso não paginante `P18_WATCHDOG_CF_PENDING`. Conferir no log do vigia `cf_gate=ACTIVE` e `cf_first_proof_at`
   preenchido.
7. **Rotação (antes do dia 90).** Gerar um token novo com o mesmo escopo e substituir o segredo `P18_DISPATCH_TOKEN`
   (mesmo nome). Esperar uma janela com `accepted` e então apagar o token antigo (Fine-grained tokens → **Delete**).
   **Revogação de emergência:** apagar o token no GitHub. As janelas seguintes dão `auth` (401) e o alerta segue no
   resumo. Para parar os pedidos de vez, apagar o segredo no Worker: o desfecho vira `unconfigured`, com alerta
   diário, e a contingência do batimento continua.

## 5. Ensaios (prova operacional), com a evidência de cada um

Para cada ensaio, registrar t_falha (início provocado), t_detecção (`at` do `zpc-alert:v1:*` e linha `p18_ext_trigger`),
t_alerta (chegada do e-mail do resumo, ou criação da issue) e t_recuperação. **Latência real = t_alerta − t_falha.**
Workers Logs persiste só uma amostra de 5% e, portanto, **não é fonte de completude** destes ensaios. Em R1 e R3,
abrir `wrangler tail --format json` antes de provocar a falha, confirmar uma invocação normal no fluxo, salvar a
sessão até a recuperação e anexar o arquivo bruto. Em R6 e R7 (24 h), o proprietário deve autorizar um deploy
temporário com `head_sampling_rate = 1`, registrar o SHA/configuração e restaurar 0,05 ao terminar; sem isso, as
linhas persistidas servem apenas como exemplos e o ensaio fica **BLOCKED**, nunca aprovado por extrapolação.
`invocation_logs=false` foi avaliado e rejeitado: reduziria contexto de exceção e desfecho necessário à investigação;
os invocation logs permanecem habilitados, enquanto a retenção normal continua limitada pela amostragem de 5%.
Limite esperado pelo desenho: detecção em até 5 min (mais até 5 min de cache do raw para o batimento), e e-mail no
próximo resumo horário do central (até 60 min). Ou seja, o canal Cloudflare leva **até cerca de 70 min**, não 10 min. A
seção 9 (10 min) trata do alerta de vendas fora do ar emitido pelo próprio monitor (issue `[P18]`), não deste meta-alerta.

| # | Ensaio | Como provocar (proprietário) | Evidência produzida | Aprovação |
|---|---|---|---|---|
| R0 | Canal de alerta ponta a ponta | Primeiro deploy, antes do primeiro batimento | `zpc-alert:v1:*` (`channel_down`, canal `p18-monitor-externo`), e-mail do resumo, `owner_alert_sent` no ledger | E-mail recebido. Latência medida |
| R1 | GitHub recusa (401) | Trocar o segredo por um valor inválido por 40 min e depois restaurar | Sessão completa de `wrangler tail` iniciada antes da falha, estado `checks.dispatch=failing/auth`, alerta, e-mail, status de falha em *Past Cron Events*, linha de recuperação 30 min ou mais após o alerta | Alerta e recuperação recebidos. Latências registradas; Workers Logs amostrado não substitui o tail |
| R2 | Atraso do runner | Natural, 24 h de operação | `runs-*.jsonl`: `dispatch_to_start_s`. Campo diário `alert_latency.max/p95_dispatch_to_start_s`, `dispatched_runs`, `duplicate_runs` | p95 publicado. Lacuna entre sondagens (`max_check_gap_s`) menor que 10 min para a seção 9 |
| R3 | Batimento ausente (204 sem monitoramento) | Desativar o workflow `P18 external monitor` (Actions → ⋯ → Disable) por 25 min | Sessão completa de `wrangler tail` iniciada antes da falha; linha `p18_ext_trigger` com o HTTP **real** do pedido para workflow desativado (a doc não fixa o código; registrar o observado) e `heartbeat=STALE` após 15 min. Alerta e e-mail | Alerta emitido com o batimento velho, mesmo se o pedido voltar 2xx; Workers Logs amostrado não basta |
| R4 | Cloudflare parada e recuperação | Remover o Cron Trigger do Worker no painel por 30 min (ou deploy com `crons=[]`) e depois restaurar | Sem linhas `p18_ext_trigger`. Com o vigia em `ACTIVE`, a issue `[P18-VIGIA] Gatilho Cloudflare parado` só aparece **quando o schedule do GitHub rodar**; o atraso observado de 5–7 h permanece risco aberto | Este PR não aprova R4. Só uma segunda via independente, ativada e ensaiada, pode estabelecer um teto |
| R5 | GitHub indisponível ou limite | Sem provocação segura. Observar ocorrências reais de 5xx, 429 e timeout | Linhas com `unavailable`, `rate_limited` (com `retry_after_s`) e `timeout`, e os alertas correspondentes | Registro de ao menos uma ocorrência real, ou BLOCKED com motivo |
| R6 | Orçamento de KV | 24 h de operação com amostragem temporária 1 autorizada e registrada | Conjunto completo das linhas `{"kvw":"p18-ext:v1:state"...}` e `{"kvw":"zpc-alert:v1"...}` com `src: panel:cron`, mais leituras inicial/final do estado. Com 0,05, marcar BLOCKED | 24/dia ou menos sem falhas, 6/h ou menos sempre |
| R7 | CPU e duração | 24 h de operação com amostragem temporária 1 autorizada e registrada | Painel do Worker → Metrics → CPU time do cron (p50/p99) antes e depois; conjunto completo do campo `ms`. Com 0,05, o painel ainda prova CPU, mas a correlação por invocação fica BLOCKED | p99 menor que 10 ms. Tarefas antigas sem regressão nos minutos 0/15/30/45 |

O CI prova o comportamento com rede e KV falsos: cada código HTTP, a janela, a idempotência, o orçamento de tempo, o
teto de gravações e o `scheduled()` real. Ele **não** prova entrega de e-mail, propagação do KV, cache do raw, latência
do GitHub nem limites reais da Cloudflare. Isso fica para os ensaios acima.

## 6. Riscos residuais (para aceite ou recusa do proprietário)

- O meta-alerta leva até cerca de 70 min (resumo horário do central). Um caminho mais rápido exigiria um endpoint do
  central por binding de serviço, o que fica como proposta separada.
- O e-mail do resumo diz "Conversas no Instagram/Facebook" no corpo (texto do central). A linha do P18 aparece como
  `[p18-monitor-externo] channel_down — "…"`.
- Achado pré-existente: os alertas atuais do painel (`alertOwner` em `worker.ts`, Instagram/Facebook) são gravados sem
  `category`. O resumo do central filtra por categoria e **apaga sem enviar**. Fora do escopo deste PR, mas registrado.
- `raw.githubusercontent.com` responde com `Cache-Control: max-age=300` e ignora query string (medido em 25/10). A idade
  do batimento vem do conteúdo, que pode estar até cerca de 5 min atrasado.
- Uma queda total da Cloudflare só é vista quando o GitHub roda o vigia, e o agendador observado está estrangulado
  (5–7 h). Não existe neste PR teto de ~75 min, solução de R4 ou prova da seção 11.
- O token fica visível para quem pode editar o Worker. A validade de 90 dias ou menos limita a janela de abuso, e o
  escopo (Actions: write em um único repositório) limita o dano a disparar ou cancelar workflows desse repositório.
- Se o estado não for gravado durante a trava de 30 min entre alertas, `since` é aproximado. O tempo da falha fica na
  linha de log e no alerta.
