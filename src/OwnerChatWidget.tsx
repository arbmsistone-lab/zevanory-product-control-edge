import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import './styles/owner-chat-widget.css';

// Chat do proprietário (Epaminondas) dentro do painel, como chat de site: botão flutuante que abre a conversa.
// A conversa em si é a página do Worker central (zevanory.api.br), com o PIN de 6 dígitos e a sessão de 12 h dela;
// o painel só a enquadra. O iframe só é criado no primeiro clique e fica montado depois (não perde a conversa).
export const OWNER_CHAT_URL = 'https://zevanory.api.br/admin/proprietario';

export function OwnerChatWidget() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const toggle = () => { setMounted(true); setOpen(value => !value); };
  return (
    <>
      {mounted && (
        <section className={`ownerChatPanel${open ? ' isOpen' : ''}`} aria-label='Chat com o Epaminondas' aria-hidden={!open}>
          <header className='ownerChatHeader'>
            <span><strong>Epaminondas</strong> · chat da ZEVANORY</span>
            <button type='button' className='ownerChatClose' onClick={() => setOpen(false)} aria-label='Fechar chat'><X size={18} /></button>
          </header>
          <iframe className='ownerChatFrame' src={OWNER_CHAT_URL} title='Chat do proprietário' referrerPolicy='no-referrer' />
        </section>
      )}
      <button type='button' className={`ownerChatFab${open ? ' isOpen' : ''}`} onClick={toggle} aria-expanded={open} aria-label={open ? 'Fechar chat' : 'Abrir chat com o Epaminondas'} title={open ? 'Fechar chat' : 'Falar com o Epaminondas'}>
        {open ? <X size={24} /> : <MessageCircle size={24} />}
      </button>
    </>
  );
}
