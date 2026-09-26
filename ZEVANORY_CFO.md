# ZEVANORY CFO v1

## Objetivo
Transformar dados financeiros reais em visão executiva, previsão de caixa, risco de recebíveis e uma fila de decisões, sem criar um ERP paralelo e sem executar movimentações externas sem prova e autorização.

## Posição no portfólio
- ZEVANORY ONE: sistema operacional/comercial.
- ARBM SIST: automação.
- ZEVANORY CONTROL CENTER: governança e comando.
- ZEVANORY CFO: inteligência financeira, cobrança, conciliação e monitoramento.
- ARBM ONE permanece sistema privado separado e pode ser consumido por adaptador, sem transferência automática de certificação.

## Contrato de segurança
- FAIL_CLOSED=true.
- autonomousMutations=false.
- Nenhum dado financeiro fictício é produzido para preencher dashboards.
- Um adaptador só pode declarar READY quando houver evidência associada.
- Cobrança, Pix, pagamento, transferência, baixa contábil ou ação externa exigem integração comprovada e fluxo de aprovação próprio.
- O cálculo de reserva tributária da v1 é apenas uma heurística operacional; não substitui apuração fiscal ou orientação contábil.

## Dados v1
- cfo_receivables_v1
- cfo_transactions_v1
- cfo_actions_v1
- cfo_adapters_v1

Os buckets usam a camada portátil dual-store existente do Control Center.

## Adaptadores previstos
1. ARBM ONE financeiro/contábil.
2. Pix/cobrança.
3. Open Finance/banco.
4. ERP externo.
5. Fiscal/documentos.

A implementação v1 inicia todos como UNCONFIGURED. READY exige readback/evidência real.

## Motor
O motor calcula:
- saldo consolidado;
- contas a receber;
- atraso;
- vencimentos do dia;
- entradas/saídas em 30 dias;
- projeção de caixa de 30 dias;
- recebíveis de alto risco;
- reserva tributária indicativa.

Também deriva uma fila de ações. Nenhuma ação derivada movimenta dinheiro.

## Reuso comprovado
O desenho prevê reutilizar, por adaptador, capacidades já existentes no ARBM ONE: núcleo contábil de partidas dobradas, integridade por hash, Pix idempotente e reconciliação por webhook. A implementação não copia credenciais nem acopla o CFO diretamente às tabelas privadas do ARBM ONE.

## Promoção
A branch `feature/zevanory-cfo-v1` possui gate remoto próprio. A promoção para `main` só deve ocorrer com:
- typecheck verde;
- contrato CFO verde;
- auditoria estrutural CFO verde;
- regressão comercial existente verde;
- build completo verde;
- revisão do diff;
- venda do novo produto ainda OFF até Legal/Pagamento/Entrega/Suporte + ZEES-16 específicos.
