import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { TimelinePage } from './pages/TimelinePage'
import { SearchPage } from './pages/SearchPage'
import { SubjectPage } from './pages/SubjectPage'
import { PlayPage } from './pages/PlayPage'
import { CollectPage } from './pages/CollectPage'
import { HistoryPage } from './pages/HistoryPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="timeline" element={<TimelinePage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="subject/:id" element={<SubjectPage />} />
        <Route path="play/:id" element={<PlayPage />} />
        <Route path="collect" element={<CollectPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
