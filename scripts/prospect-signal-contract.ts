import assert from 'node:assert/strict';
import { assessMarketSignal } from '../src/prospect-signal.ts';

// Real noise observed in production on 2026-10-06 must never reach the panel.
const noise = [
  { title: 'Clínica Consulta | Consultas e Exames Médicos com Especialistas', detail: 'Exames médicos, check-ups e atendimento humanizado.', url: 'https://clinicaconsulta.com.br/' },
  { title: 'WhatsApp Web Entrar: Como acessar e usar no Computador passo a passo', detail: 'Aprenda a acessar o WhatsApp no PC.', url: 'https://exemplo.com.br/whatsapp-web' },
  { title: 'Resultados On-line - Instituto de Patologia Clinica Molecular', detail: 'Confira suas credenciais de acesso.', url: 'https://ipcm.com.br/' },
  { title: 'Loja de roupas no centro', detail: 'Moda feminina e masculina.', url: 'https://loja.com.br/' },
  { title: 'Meio ambiente e sustentabilidade', detail: 'loja', url: 'https://x.com.br/' },
  { title: 'Pequenas empresas: CRM grátis', detail: 'tutorial', url: 'https://www.techtudo.com.br/crm' },
];
for (const item of noise) assert.equal(assessMarketSignal(item).useful, false, 'noise accepted: ' + item.title);

const useful = [
  { title: 'Como pequenas empresas podem aumentar vendas com CRM no WhatsApp', detail: 'Guia para loja de varejo.', url: 'https://consultoria.com.br/crm' },
  { title: 'Salão de beleza: controle financeiro e fluxo de caixa simples', detail: '', url: 'https://saloes.com.br/financeiro' },
  { title: 'NR-1 e riscos psicossociais para microempresa', detail: 'PGR obrigatório', url: 'https://sst.com.br/nr1' },
];
for (const item of useful) assert.equal(assessMarketSignal(item).useful, true, 'signal rejected: ' + item.title);

console.log('PROSPECT_SIGNAL_CONTRACT=PASS');
