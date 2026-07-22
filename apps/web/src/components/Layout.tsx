import { FormEvent, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import clsx from 'clsx'

const links = [
  { to: '/', label: '首页', end: true },
  { to: '/timeline', label: '时间表' },
  { to: '/collect', label: '追番' },
  { to: '/history', label: '历史' },
  { to: '/settings', label: '设置' },
]

export function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const qFromUrl =
    location.pathname === '/search' ? params.get('q') || '' : ''
  const [q, setQ] = useState(qFromUrl)

  useEffect(() => {
    if (location.pathname === '/search') {
      setQ(params.get('q') || '')
    }
  }, [location.pathname, params])

  function onSearch(e: FormEvent) {
    e.preventDefault()
    const keyword = q.trim()
    if (!keyword) {
      navigate('/search')
      return
    }
    navigate(`/search?q=${encodeURIComponent(keyword)}`)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <NavLink
            to="/"
            className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500 text-sm text-white">
              K
            </span>
            <span className="hidden sm:inline">Kazumi Web</span>
          </NavLink>

          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  clsx(
                    'rounded-md px-3 py-1.5 text-sm whitespace-nowrap',
                    isActive
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <form
            onSubmit={onSearch}
            className="flex shrink-0 items-center gap-1.5"
            role="search"
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索番剧…"
              aria-label="搜索番剧"
              className="w-28 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm outline-none ring-sky-600 placeholder:text-zinc-500 focus:ring-2 sm:w-44 md:w-56"
            />
            <button
              type="submit"
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500"
            >
              搜索
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-zinc-900 py-4 text-center text-xs text-zinc-500">
        仅供学习研究 · 请遵守当地法律法规 · 数据来自 Bangumi / 弹弹play ·
        规则由用户自行导入
      </footer>
    </div>
  )
}
