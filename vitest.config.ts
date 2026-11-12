import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

// Two projects so server-side code runs under Node while React components run
// under jsdom, each with the matching globals and setup.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          name: 'server',
          environment: 'node',
          include: ['lib/**/*.test.ts', 'app/api/**/*.test.ts'],
        },
      },
      {
        plugins: [tsconfigPaths(), react()],
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['app/components/**/*.test.tsx'],
          setupFiles: ['./test/setup-dom.tsx'],
        },
      },
    ],
  },
})
