import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import './styles/owner-chat-widget.css';

// Chat do proprietário (Epaminondas) dentro do painel, como chat de site: botão flutuante que abre a conversa.
// A conversa em si é a página do Worker central (zevanory.api.br), com o PIN de 6 dígitos e a sessão de 12 h dela;
// o painel só a enquadra. O iframe só é criado no primeiro clique e fica montado depois (não perde a conversa).
export const OWNER_CHAT_URL = 'https://zevanory.api.br/admin/proprietario';

export function OwnerChatWidget() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const toggle = () => { setMounted(true); setOpen(value => !value); };
  // Teclado (E3): ao abrir, o foco vai para "Fechar"; Esc fecha; ao fechar, o foco volta para o botão flutuante.
  useEffect(() => {
    if (open) closeRef.current?.focus();
    else if (wasOpen.current) fabRef.current?.focus();
    wasOpen.current = open;
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      {mounted && (
        <section data-owner-chat-widget='' className={`ownerChatPanel${open ? ' isOpen' : ''}`} aria-label='Chat com o Epaminondas' aria-hidden={!open}>
          <header className='ownerChatHeader'>
            <span><strong>Epaminondas</strong> · chat da ZEVANORY</span>
            <button ref={closeRef} type='button' className='ownerChatClose' onClick={() => setOpen(false)} aria-label='Fechar chat'><X size={18} /></button>
          </header>
          <iframe className='ownerChatFrame' src={OWNER_CHAT_URL} title='Chat do proprietário' referrerPolicy='no-referrer' />
        </section>
      )}
      <button ref={fabRef} type='button' data-owner-chat-widget='' className={`ownerChatFab${open ? ' isOpen' : ''}`} onClick={toggle} aria-expanded={open} aria-label={open ? 'Fechar chat' : 'Abrir chat com o Epaminondas'} title={open ? 'Fechar chat' : 'Falar com o Epaminondas'}>
        {open ? <X size={24} /> : <MessageCircle size={24} />}
      </button>
    </>
  );
}
