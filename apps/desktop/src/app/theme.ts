import { createTheme } from '@mantine/core';

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 6, dark: 4 },
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
  components: {
    Modal: {
      styles: {
        content: {
          background: 'var(--surface)',
          border: '1px solid var(--border)',
        },
        header: {
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '12px',
        },
        title: {
          color: 'var(--text-primary)',
          fontWeight: 700,
          fontSize: '17px',
          letterSpacing: '-0.01em',
        },
        close: {
          color: 'var(--text-muted)',
        },
        overlay: {
          backdropFilter: 'blur(6px)',
        },
      },
    },
    TextInput: {
      styles: {
        label: { color: 'var(--text-secondary)', fontWeight: 600, fontSize: '12px' },
        input: {
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
        },
      },
    },
    PasswordInput: {
      styles: {
        label: { color: 'var(--text-secondary)', fontWeight: 600, fontSize: '12px' },
        input: {
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
        },
      },
    },
    Textarea: {
      styles: {
        label: { color: 'var(--text-secondary)', fontWeight: 600, fontSize: '12px' },
        input: {
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
          fontSize: '14px',
          lineHeight: '1.6',
        },
      },
    },
    Select: {
      styles: {
        label: { color: 'var(--text-secondary)', fontWeight: 600, fontSize: '12px' },
        input: {
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
        },
        dropdown: {
          background: 'var(--surface)',
          border: '1px solid var(--border)',
        },
        option: {
          color: 'var(--text-primary)',
        },
      },
    },
    Radio: {
      styles: {
        label: { color: 'var(--text-primary)', fontSize: '13px' },
      },
    },
  },
});
