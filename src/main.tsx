import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './styles/tokens.css';
import './styles/shell.css';
import './styles/products.css';
import './styles/commercial-v2.css';
import './styles/cfo-v2.css';
import './styles/canonical-v4.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
