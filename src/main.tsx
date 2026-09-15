import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { TeacherProfilesProvider } from './context/TeacherProfilesContext';
import { ToastProvider } from './context/ToastContext';
import './styles/base.css';
import './styles/import-dialogs.css';
import './styles/comic.css';
import './styles/paste-import.css';
import './styles/lesson-focus.css';
import './styles/mobile.css';
import './styles/teacher.css';
import './styles/modern.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <TeacherProfilesProvider>
        <App />
      </TeacherProfilesProvider>
    </ToastProvider>
  </StrictMode>,
);
