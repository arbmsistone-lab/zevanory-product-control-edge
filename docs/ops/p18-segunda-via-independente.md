# P18 | Segunda via independente da Cloudflare — proposta, não ativada

## Estado e regra de decisão

Este documento é somente uma proposta. Nenhuma conta, credencial, monitor, job ou trigger foi criado. A ativação
depende de decisão conjunta do Sol e do proprietário. Toda credencial citada abaixo é criada e instalada exclusivamente
pelo proprietário; ela não passa por PR, chat, log ou evidência.

O cron do Worker não é segunda via: se a Cloudflare inteira parar, o cron e qualquer pedido de vigia feito por ele
param juntos. Portanto o PR #214 não resolve o R4, não prova a seção 11 e não estabelece teto de ~75 min.

## Comparação

| Opção | Custo | Credencial e responsável | Latência de detecção | Modos de falha | Como provar no R4 |
|---|---|---|---|---|---|
| **A. Supabase `pg_cron` + `pg_net` → `workflow_dispatch` do vigia** | Sem custo incremental enquanto o projeto existente permanecer dentro do plano/cotas atuais. O Cron usa `pg_cron`; `pg_net` faz POST assíncrono. **Risco Free:** projetos com baixa atividade por 7 dias podem ser pausados; algumas chamadas diárias normalmente geram atividade, mas isso precisa ser comprovado no projeto e o aviso de pausa acompanhado. | Token fine-grained exclusivo, criado pelo **proprietário**, limitado a `arbmsistone-lab/zevanory-public-mirror` e `Actions: write`; guardar no Vault do projeto. Não reutilizar `P18_DISPATCH_TOKEN`. | Job de hora em hora + limiar de 15 min do vigia: desenho nominal de até ~75 min, a confirmar em ensaio; fila do GitHub pode acrescentar atraso. | Projeto pausado por inatividade/indisponível, job desabilitado, extensão/worker do Postgres parado, fila `pg_net` perdida em crash (tabelas unlogged), token expirado/revogado, API/runner do GitHub indisponível. O próprio Supabase não pode ser a única evidência de sua saúde. | Com a Cloudflare desativada, guardar `cron.job_run_details`, resposta de `net._http_response`, execução GitHub com `event=workflow_dispatch`, issue `[P18-VIGIA]` e horários falha/detecção/alerta/recuperação. Repetir com token inválido e com projeto retomado após pausa para provar falha visível e recuperação. |
| **B. UptimeRobot Free → verificação HTTPS e alerta por e-mail** | Plano Free informado pelo fornecedor: 50 monitores, checagens de 5 min, sem cartão. Uso comercial é permitido, mas sujeito a Fair Use; é proibido revender, reempacotar ou oferecer dados/alertas/API/status page como serviço de monitoramento independente ou rebatizado sem acordo comercial separado. | Conta e endereço de alerta configurados pelo **proprietário**. Para URL pública não há token GitHub; se autenticação for necessária, o segredo pertence ao proprietário e não deve ir na URL. | Nominalmente uma checagem em até 5 min, mais confirmação/entrega do e-mail. Mede disponibilidade da URL, não executa o vigia nem valida `cf-dispatch.json`. | Falso verde por CDN/cache, endpoint escolhido não representar a Cloudflare, e-mail atrasado/spam, monitor pausado, indisponibilidade do fornecedor, Fair Use/limites do plano ou mudança do serviço. **Se apenas o cron parar e a URL continuar respondendo, esta opção não detecta a falha.** | Desativar a Cloudflare, provar no painel do monitor a transição DOWN e recuperação, e guardar e-mail com timestamps. Para R4, a URL deve ser exclusivamente servida pela Cloudflare e responder sem cache enganoso. Não prova parada isolada do cron nem, sozinha, a lógica da issue `[P18-VIGIA]`. |
| **C. Google Apps Script time-driven → `workflow_dispatch` do vigia** | Sem custo direto dentro das cotas da conta Google; 24 chamadas/dia ficam muito abaixo da cota publicada de URL Fetch. Cotas podem mudar. | Token fine-grained exclusivo, criado pelo **proprietário**, com o mesmo escopo mínimo da opção A; guardar em Script Properties, nunca no código. O trigger roda como a conta que o criou. | Trigger horário; o horário pode ser levemente aleatório. Nominalmente ~75 min com o limiar de 15 min, sem garantia até o ensaio. | Trigger removido/desautorizado, conta suspensa, quota excedida, falha do Apps Script/Google, token expirado, GitHub indisponível. Falhas do trigger geram e-mail do Apps Script, mas esse e-mail também precisa ser testado. | Desativar a Cloudflare e guardar execução do Apps Script, resposta HTTP do GitHub, execução `workflow_dispatch`, issue do vigia e e-mail de erro em ensaio separado com token inválido. |

Fontes oficiais consultadas em 26/10/2026:

- [Supabase Cron (`pg_cron`)](https://supabase.com/docs/guides/cron) e [quickstart com HTTP/`pg_net`](https://supabase.com/docs/guides/cron/quickstart)
- [Supabase: pausa automática de projeto Free por baixa atividade em 7 dias](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase `pg_net`: fila, respostas e limitações](https://supabase.com/docs/guides/database/extensions/pg_net)
- [Supabase Vault e ressalva de exposição transitória na fila do `pg_net`](https://supabase.com/docs/guides/functions/schedule-functions)
- [UptimeRobot Free: 50 monitores e intervalo de 5 min](https://help.uptimerobot.com/en/articles/11604710-who-should-use-uptimerobot-s-free-plan)
- [UptimeRobot: Terms/Fair Use, uso comercial permitido e vedação de revenda/reempacotamento](https://uptimerobot.com/terms/)
- [Google Apps Script: triggers instaláveis](https://developers.google.com/apps-script/guides/triggers/installable) e [cotas](https://developers.google.com/apps-script/guides/services/quotas)

## Recomendação

Recomenda-se **A (Supabase)** como segunda via funcional, porque o projeto já existe na conta, o job e suas execuções
ficam auditáveis no banco e o caminho consegue acordar exatamente o vigia já existente. A opção B deve ser considerada
uma camada adicional de alerta humano, não substituta do vigia. A opção C é uma reserva aceitável se o Sol recusar
guardar um token GitHub no Supabase, mas acrescenta outra conta e governança menos centralizada.

Antes da ativação, o proprietário deve aprovar por escrito: plataforma escolhida, escopo/validade do token, responsável
pela rotação, destinatários do alerta e critério de abandono. Depois, R4 só pode ser aprovado com um ensaio real de
queda da Cloudflare e com timestamps completos. Até lá, o estado permanece **proposto / não ativado / R4 aberto**.
