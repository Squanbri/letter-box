import { createContext, useContext, useEffect, useState } from 'react';

export function useDarkModeState() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('letter-box.theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('letter-box.theme', dark ? 'dark' : 'light');
  }, [dark]);

  return [dark, setDark] as const;
}

export const DarkModeContext = createContext<{
  dark: boolean;
  setDark: (fn: (prev: boolean) => boolean) => void;
}>({ dark: false, setDark: () => {} });

export function useDarkMode() {
  return useContext(DarkModeContext);
}
