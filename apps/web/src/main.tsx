import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { bootstrapPlugins } from './stores/plugins'
import './index.css'
// Player frame / placeholder sizing shared by VideoPlayer, EmbedPlayer, SubjectPage
import './player/plyr-overrides.css'

// Seed built-in rules if localStorage is empty (legacy empty store, first visit)
bootstrapPlugins()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root not found')
}

createRoot(rootEl).render(
  // StrictMode double-mounts effects in dev, which tears down HLS MSE mid-load
  // (blob: ERR_FILE_NOT_FOUND) and looks like "can't play". Production is fine either way.
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </ErrorBoundary>,
)
