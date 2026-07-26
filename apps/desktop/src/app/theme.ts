import { createTheme } from '@mantine/core';

export const theme = createTheme({
  primaryColor: 'paperGold',
  primaryShade: { light: 7, dark: 6 },
  autoContrast: true,
  luminanceThreshold: 0.35,
  defaultRadius: 'sm',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
  headings: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
  },
  colors: {
    paperGold: [
      '#fff9e8',
      '#f8edca',
      '#efdda5',
      '#e5cb7e',
      '#d8b755',
      '#c99e32',
      '#b48326',
      '#95691b',
      '#755015',
      '#55390e',
    ],
  },
});
