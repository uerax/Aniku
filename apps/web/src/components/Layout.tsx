import { FormEvent, useEffect, useState } from 'react'
import {
  NavLink,
  Outlet,
  useNavigate,
  useSearchParams,
  useLocation,
} from 'react-router-dom'
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

  const isWatch =
    location.pathname.startsWith('/subject/') ||
    location.pathname.startsWith('/play/')

  return (
    <div className="flex min-h-screen flex-col bg-[var(--kz-bg)] text-[var(--kz-fg)]">
      <header className="sticky top-0 z-40 border-b border-[var(--kz-border)] bg-black/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1760px] items-center gap-3 px-4 py-2 sm:px-5 lg:px-6">
          <NavLink
            to="/"
            className="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight"
          >
            <img
              src="/favicon-32x32.png"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 rounded-full ring-1 ring-[var(--kz-border)]"
              decoding="async"
            />
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="text-[15px] font-bold tracking-tight">
                Aniku
              </span>
              <span className="text-[10px] font-normal text-[var(--kz-fg-muted)]">
                本地番剧 · 规则选源
              </span>
            </span>
          </NavLink>

          <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  clsx(
                    'relative whitespace-nowrap px-3.5 py-2.5 text-[15px] font-medium transition-colors',
                    isActive
                      ? 'font-bold text-[var(--kz-fg)]'
                      : 'text-[var(--kz-fg-muted)] hover:bg-[var(--kz-bg-hover)] hover:text-[var(--kz-fg)]',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {l.label}
                    {isActive && (
                      <span
                        className="absolute inset-x-3 bottom-0 h-1 rounded-full bg-[var(--kz-accent)]"
                        aria-hidden
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <form
            onSubmit={onSearch}
            className="flex shrink-0 items-center gap-1.5"
            role="search"
          >
            <div className="relative">
              <span
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--kz-fg-muted)]"
                aria-hidden
              >
                ⌕
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索番剧…"
                aria-label="搜索番剧"
                className="w-28 rounded-full border border-transparent bg-[var(--kz-bg-elevated)] py-2 pl-9 pr-3 text-[14px] text-[var(--kz-fg)] outline-none placeholder:text-[var(--kz-fg-muted)] focus:border-[var(--kz-accent)] focus:bg-black sm:w-48 md:w-64"
              />
            </div>
            <button type="submit" className="kz-btn-primary !py-2 !px-4">
              搜索
            </button>
          </form>
        </div>
      </header>

      <main
        className={clsx(
          'mx-auto w-full flex-1',
          isWatch
            ? 'max-w-[1760px] px-0 py-3 sm:px-5 sm:py-4 lg:px-6'
            : 'max-w-[1760px] px-4 py-6 sm:px-5 lg:px-6',
        )}
      >
        <Outlet />
      </main>

      {!isWatch && (
        <footer className="border-t border-[var(--kz-border)] py-5 text-center text-[12px] leading-relaxed text-[var(--kz-fg-muted)]">
          Aniku · 仅供学习研究 · 请遵守当地法律法规
          <br className="sm:hidden" />
          <span className="hidden sm:inline"> · </span>
          数据来自 Bangumi / 弹弹play · 规则由用户自行导入
        </footer>
      )}
    </div>
  )
}
