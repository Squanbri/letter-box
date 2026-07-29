import { AppProviders } from './app/AppProviders';
import { AppShell } from './app/AppShell';
import { DarkModeContext, useDarkModeState } from './app/darkMode';

export function App() {
  const [dark, setDark] = useDarkModeState();
  return (
    <DarkModeContext.Provider value={{ dark, setDark }}>
      <AppProviders dark={dark}>
        <AppShell />
      </AppProviders>
    </DarkModeContext.Provider>
  );
}
