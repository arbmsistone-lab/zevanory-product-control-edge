import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { api } from './api';
import './styles/owner-chat-widget.css';

// Epaminondas fixo na coluna esquerda do painel (27/11/2026), logo abaixo de "Sistema": sempre aberto enquanto a sessão
// do proprietário no painel for válida, sem PIN separado, sem botão de abrir nem de fechar.
// A conversa é a página do Worker central (zevanory.api.br) num iframe que nunca é desmontado ao trocar de seção (o
// texto digitado e a conversa ficam). A autenticação vem do PAINEL: esta borda confere a sessão e entrega um passe de
// 60 s, de uso único, que a página do chat troca por uma sessão de até 5 min (renovada aqui a cada 2 min). Sair do
// painel manda o chat encerrar a sessão no servidor antes de limpar a sessão do painel.
export const OWNER_CHAT_URL = 'https://zevanory.api.br/admin/proprietario';
const OWNER_CHAT_ORIGIN = new URL(OWNER_CHAT_URL).origin;
export const RENEW_MS = 120_000;
const LOGOUT_WAIT_MS = 4000;

export type OwnerChatDockHandle = { endSession: () => Promise<boolean> };

type Props = { sessionToken: string; theme: 'dark' | 'light' };

export const OwnerChatDock = forwardRef<OwnerChatDockHandle, Props>(function OwnerChatDock({ sessionToken, theme }, ref) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const tokenRef = useRef(sessionToken);
  const endingRef = useRef(false);
  const themeRef = useRef(theme);
  tokenRef.current = sessionToken;
  themeRef.current = theme;

  const post = useCallback((message: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(message, OWNER_CHAT_ORIGIN);
  }, []);

  // Pede um passe novo à borda do painel (que confere a sessão) e entrega só à janela do chat, na origem do chat.
  const sendTicket = useCallback(async () => {
    if (endingRef.current || !tokenRef.current) return;
    try {
      const { data } = await api.post('/api/owner/chat/ticket', { sessionToken: tokenRef.current });
      if (endingRef.current || !data?.ticket) return;
      post({ type: 'zv-owner-chat:ticket', ticket: data.ticket });
    } catch {
      // Sem passe (sessão do painel vencida ou revogada, ou falha): o chat perde o acesso em até 5 min sozinho.
    }
  }, [post]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== OWNER_CHAT_ORIGIN || !frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const type = (event.data as { type?: unknown } | null)?.type;
      if (type === 'zv-owner-chat:need-ticket' || type === 'zv-owner-chat:ready') {
        post({ type: 'zv-owner-chat:theme', theme: themeRef.current });
        if (type === 'zv-owner-chat:need-ticket') void sendTicket();
      }
    };
    window.addEventListener('message', onMessage);
    const timer = window.setInterval(() => { void sendTicket(); }, RENEW_MS);
    return () => { window.removeEventListener('message', onMessage); window.clearInterval(timer); };
  }, [post, sendTicket]);

  useEffect(() => { post({ type: 'zv-owner-chat:theme', theme }); }, [theme, post]);

  // Sair do painel: para de emitir passes e pede ao chat o logout no servidor; espera a confirmação (no máximo 4 s).
  useImperativeHandle(ref, () => ({
    endSession: () => new Promise<boolean>(resolve => {
      endingRef.current = true;
      const frame = frameRef.current;
      if (!frame?.contentWindow) { resolve(false); return; }
      let done = false;
      const finish = (ok: boolean) => { if (done) return; done = true; window.removeEventListener('message', onMessage); window.clearTimeout(t); resolve(ok); };
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== OWNER_CHAT_ORIGIN || event.source !== frame.contentWindow) return;
        const data = event.data as { type?: unknown; ok?: unknown } | null;
        if (data?.type === 'zv-owner-chat:logged-out') finish(data.ok === true);
      };
      window.addEventListener('message', onMessage);
      const t = window.setTimeout(() => finish(false), LOGOUT_WAIT_MS);
      post({ type: 'zv-owner-chat:logout' });
    }),
  }), [post]);

  return (
    <section className='ownerChatDock' data-owner-chat-widget='' aria-label='Chat com o Epaminondas'>
      <iframe ref={frameRef} className='ownerChatFrame' src={OWNER_CHAT_URL} title='Chat com o Epaminondas' referrerPolicy='no-referrer' />
    </section>
  );
});
