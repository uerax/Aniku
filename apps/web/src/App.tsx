import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { LoadingState } from './components/ui'

// Light routes: static import — avoid per-nav RTT for ~1–30KB pages.
import { HomePage } from './pages/HomePage'
import { TimelinePage } from './pages/TimelinePage'
import { AnimePage } from './pages/AnimePage'
import { SearchPage } from './pages/SearchPage'
import { CollectPage } from './pages/CollectPage'
import { HistoryPage } from './pages/HistoryPage'
import { SettingsPage } from './pages/SettingsPage'

// Heavy watch stack only — player / hls / anime4k stay behind these chunks.
const SubjectPage = lazy(() =>
  import('./pages/SubjectPage').then((m) => ({ default: m.SubjectPage })),
)
const PlayPage = lazy(() =>
  import('./pages/PlayPage').then((m) => ({ default: m.PlayPage })),
)

function PageFallback() {
  return (
    <div className="py-12">
      <LoadingState text="加载页面…" />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="timeline" element={<TimelinePage />} />
        <Route path="anime" element={<AnimePage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="collect" element={<CollectPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="settings" element={<SettingsPage />} />
        {/* Suspense only around lazy watch routes — light pages never wait on chunk */}
        <Route
          path="subject/:id"
          element={
            <Suspense fallback={<PageFallback />}>
              <SubjectPage />
            </Suspense>
          }
        />
        <Route
          path="play/:id"
          element={
            <Suspense fallback={<PageFallback />}>
              <PlayPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  )
}
