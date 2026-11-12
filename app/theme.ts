import { createTheme } from '@mui/material/styles'

// Shares the near-black palette of the other malna apps, with its own accent.
export const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'dark',
    primary: {
      main: '#2dd4bf',
    },
    background: {
      default: '#0a0a0a',
      paper: '#1a1a1a',
    },
    text: {
      primary: '#ededed',
    },
  },
  typography: {
    fontFamily: 'var(--font-geist-sans), Arial, Helvetica, sans-serif',
  },
  shape: {
    borderRadius: 8,
  },
})
