import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { LoadingState } from './components/ui'

// Route-level code split: home/search stay light; player stack loads on demand
const HomePage = lazy(() =>
  import('./pages/HomePage').then((m) => ({ default: m.HomePage })),
)
const TimelinePage = lazy(() =>
  import('./pages/TimelinePage').then((m) => ({ default: m.TimelinePage })),
)
const AnimePage = lazy(() =>
  import('./pages/AnimePage').then((m) => ({ default: m.AnimePage })),
)
const SearchPage = lazy(() =>
  import('./pages/SearchPage').then((m) => ({ default: m.SearchPage })),
)
const SubjectPage = lazy(() =>
  import('./pages/SubjectPage').then((m) => ({ default: m.SubjectPage })),
)
const PlayPage = lazy(() =>
  import('./pages/PlayPage').then((m) => ({ default: m.PlayPage })),
)
const CollectPage = lazy(() =>
  import('./pages/CollectPage').then((m) => ({ default: m.CollectPage })),
)
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })),
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
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
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="timeline" element={<TimelinePage />} />
          <Route path="anime" element={<AnimePage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="subject/:id" element={<SubjectPage />} />
          <Route path="play/:id" element={<PlayPage />} />
          <Route path="collect" element={<CollectPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
