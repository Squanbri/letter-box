import { createTheme } from '@mantine/core';

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 6, dark: 5 },
  autoContrast: true,
  luminanceThreshold: 0.35,
  defaultRadius: 'sm',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
  headings: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
  },
  colors: {
    brand: [
      '#e6fff0',
      '#ccfde0',
      '#9af8c0',
      '#5ef09d',
      '#20e070',
      '#00c750',
      '#00a63e',
      '#008f35',
      '#006e29',
      '#004d1c',
    ],
  },
});
