import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/comic.css';
import './styles/app.css';
import './styles/entry.css';

const container = document.getElementById('root');

if (!container) throw new Error('未找到 #root 挂载点');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
