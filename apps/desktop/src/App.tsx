import { AppProviders } from './app/AppProviders';
import { AppShell } from './app/AppShell';
import { ComposeWindowApp } from './pages/compose/ComposeWindowApp';

function composeIdFromLocation(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('compose');
  } catch {
    return null;
  }
}

export function App() {
  const composeId = composeIdFromLocation();
  return (
    <AppProviders>
      {composeId ? <ComposeWindowApp composeId={composeId} /> : <AppShell />}
    </AppProviders>
  );
}
