import { createTheme } from '@mantine/core';

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 6, dark: 4 },
  autoContrast: true,
  luminanceThreshold: 0.35,
  defaultRadius: 'sm',
  fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
  fontFamilyMonospace: '"IBM Plex Mono", ui-monospace, monospace',
  headings: {
    fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
  },
  colors: {
    brand: [
      '#e4efe7',
      '#cfe0d5',
      '#9fcbb0',
      '#6aad85',
      '#3d9161',
      '#2a8755',
      '#1f7a4d',
      '#17633e',
      '#124f32',
      '#0c3723',
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
          fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
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
    Switch: {
      defaultProps: {
        color: 'brand',
        size: 'sm',
      },
      styles: {
        root: {
          '--switch-width': '36px',
          '--switch-height': '20px',
          '--switch-thumb-size': '16px',
        },
        track: {
          cursor: 'pointer',
          border: '1px solid var(--border-input)',
          background: 'var(--chip)',
          transition: 'background 120ms ease, border-color 120ms ease',
        },
        thumb: {
          border: '1px solid color-mix(in srgb, var(--border-strong) 70%, transparent)',
          boxShadow: '0 1px 2px rgb(23 21 15 / 10%)',
        },
        label: {
          color: 'var(--ink-body)',
          fontSize: '13px',
          fontWeight: 500,
          paddingLeft: '8px',
          lineHeight: 1.35,
          cursor: 'pointer',
        },
      },
    },
    Checkbox: {
      defaultProps: {
        color: 'brand',
        size: 'sm',
        radius: 'sm',
      },
      styles: {
        root: {
          alignItems: 'flex-start',
        },
        input: {
          cursor: 'pointer',
          border: '1.5px solid var(--border-input)',
          background: 'var(--surface)',
          transition: 'background 120ms ease, border-color 120ms ease',
        },
        icon: {
          color: '#fff',
        },
        label: {
          color: 'var(--ink-body)',
          fontSize: '13px',
          fontWeight: 500,
          paddingLeft: '8px',
          lineHeight: 1.4,
          cursor: 'pointer',
        },
      },
    },
  },
});
