import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@mantine/core/styles.css';
import { App } from './App';
import { api } from './shared/api/client';
import './app/global.css';

window.addEventListener('error', (event) => {
  void api.reportError(
    event.message,
    event.error instanceof Error ? event.error.stack : undefined,
  ).catch(() => undefined);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  void api.reportError(message, stack).catch(() => undefined);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
