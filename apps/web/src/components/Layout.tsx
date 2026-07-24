import { FormEvent, useEffect, useRef, useState } from 'react'
import {
  NavLink,
  Outlet,
  useNavigate,
  useSearchParams,
  useLocation,
} from 'react-router-dom'
import clsx from 'clsx'
import { useSettingsStore } from '../stores/settings'

/** Always visible in the top strip (mobile + desktop). */
const primaryLinks = [
  { to: '/', label: '首页', end: true },
  { to: '/anime', label: '番剧' },
]

/** Desktop strip + mobile overflow menu. */
const moreLinks = [
  { to: '/timeline', label: '时间表' },
  { to: '/collect', label: '追番' },
  { to: '/history', label: '历史' },
  { to: '/settings', label: '设置' },
]

function ThemeToggleButton() {
  const theme = useSettingsStore((s) => s.theme)
  const toggleTheme = useSettingsStore((s) => s.toggleTheme)
  const isLight = theme === 'light'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)] text-[var(--kz-fg)] transition-colors hover:bg-[var(--kz-bg-hover)] hover:border-[var(--kz-fg-dim)]"
      title={isLight ? '切换到深色主题' : '切换到浅色主题'}
      aria-label={isLight ? '切换到深色主题' : '切换到浅色主题'}
    >
      {isLight ? (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
        </svg>
      ) : (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )}
    </button>
  )
}

function NavItem({
  to,
  label,
  end,
  onNavigate,
}: {
  to: string
  label: string
  end?: boolean
  onNavigate?: () => void
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          'relative whitespace-nowrap px-3 py-2.5 text-[15px] font-bold tracking-wide transition-colors sm:px-3.5 sm:text-[16px]',
          isActive
            ? 'text-[var(--kz-fg)]'
            : 'text-[var(--kz-fg-muted)] hover:bg-[var(--kz-bg-hover)] hover:text-[var(--kz-fg)]',
        )
      }
    >
      {({ isActive }) => (
        <>
          {label}
          {isActive && (
            <span
              className="absolute inset-x-3 bottom-0 h-1 rounded-full bg-[var(--kz-accent)]"
              aria-hidden
            />
          )}
        </>
      )}
    </NavLink>
  )
}

function MenuIcon({ open }: { open: boolean }) {
  return open ? (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ) : (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3-3" />
    </svg>
  )
}

export function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const qFromUrl =
    location.pathname === '/search' ? params.get('q') || '' : ''
  const [q, setQ] = useState(qFromUrl)
  const [menuOpen, setMenuOpen] = useState(false)
  /** Mobile: icon-only until user opens search; desktop always shows field. */
  const [mobileSearchOpen, setMobileSearchOpen] = useState(
    () => location.pathname === '/search',
  )
  const mobileSearchInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (location.pathname === '/search') {
      setQ(params.get('q') || '')
      setMobileSearchOpen(true)
    }
  }, [location.pathname, params])

  // Close overflow menu on route change
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  // Outside click / Escape for menu
  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    if (mobileSearchOpen) {
      // Focus after expand so mobile keyboard opens
      const t = window.setTimeout(() => mobileSearchInputRef.current?.focus(), 30)
      return () => window.clearTimeout(t)
    }
  }, [mobileSearchOpen])

  function onSearch(e: FormEvent) {
    e.preventDefault()
    const keyword = q.trim()
    if (!keyword) {
      navigate('/search')
      return
    }
    navigate(`/search?q=${encodeURIComponent(keyword)}`)
    setMenuOpen(false)
  }

  const moreActive = moreLinks.some(
    (l) =>
      location.pathname === l.to ||
      (l.to !== '/' && location.pathname.startsWith(l.to + '/')),
  )

  const isWatch =
    location.pathname.startsWith('/subject/') ||
    location.pathname.startsWith('/play/')

  return (
    <div className="flex min-h-screen flex-col bg-[var(--kz-bg)] text-[var(--kz-fg)]">
      <header className="sticky top-0 z-40 border-b border-[var(--kz-border)] bg-[var(--kz-header-bg)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1760px] items-center gap-2 px-3 py-2 sm:gap-3 sm:px-5 lg:px-6">
          <NavLink
            to="/"
            className="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight"
            onClick={() => setMenuOpen(false)}
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

          {/* Primary tabs — no horizontal scroll on mobile */}
          <nav
            className="flex min-w-0 flex-1 items-center gap-0.5 sm:gap-1"
            aria-label="主导航"
          >
            {primaryLinks.map((l) => (
              <NavItem key={l.to} {...l} />
            ))}

            {/* Desktop: rest of links inline */}
            <div className="hidden items-center gap-0.5 md:flex">
              {moreLinks.map((l) => (
                <NavItem key={l.to} {...l} />
              ))}
            </div>

            {/* Mobile: overflow menu for remaining destinations */}
            <div className="relative md:hidden" ref={menuRef}>
              <button
                type="button"
                className={clsx(
                  'relative inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-2 text-[15px] font-bold tracking-wide transition-colors',
                  moreActive || menuOpen
                    ? 'text-[var(--kz-fg)]'
                    : 'text-[var(--kz-fg-muted)] hover:bg-[var(--kz-bg-hover)] hover:text-[var(--kz-fg)]',
                )}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label="更多导航"
                onClick={() => setMenuOpen((v) => !v)}
              >
                更多
                <MenuIcon open={menuOpen} />
                {moreActive && !menuOpen && (
                  <span
                    className="absolute inset-x-2 bottom-0 h-1 rounded-full bg-[var(--kz-accent)]"
                    aria-hidden
                  />
                )}
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-[10.5rem] overflow-hidden rounded-xl border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)] py-1 shadow-lg"
                >
                  {moreLinks.map((l) => (
                    <NavLink
                      key={l.to}
                      to={l.to}
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className={({ isActive }) =>
                        clsx(
                          'block px-4 py-2.5 text-[15px] font-semibold transition-colors',
                          isActive
                            ? 'bg-[var(--kz-bg-hover)] text-[var(--kz-accent)]'
                            : 'text-[var(--kz-fg)] hover:bg-[var(--kz-bg-hover)]',
                        )
                      }
                    >
                      {l.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          </nav>

          {/* Desktop search — always visible field */}
          <form
            onSubmit={onSearch}
            className="hidden shrink-0 items-center gap-1.5 md:flex"
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
                className="w-48 rounded-full border border-transparent bg-[var(--kz-bg-elevated)] py-2 pl-9 pr-3 text-[14px] text-[var(--kz-fg)] outline-none placeholder:text-[var(--kz-fg-muted)] focus:border-[var(--kz-accent)] focus:bg-[var(--kz-bg)] lg:w-64"
              />
            </div>
            <button type="submit" className="kz-btn-primary !px-4 !py-2">
              搜索
            </button>
          </form>

          {/* Mobile search — icon, expands to field */}
          <div className="flex shrink-0 items-center gap-1.5 md:hidden">
            {mobileSearchOpen ? (
              <form
                onSubmit={onSearch}
                className="flex items-center gap-1"
                role="search"
              >
                <input
                  ref={mobileSearchInputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="搜索番剧…"
                  aria-label="搜索番剧"
                  className="w-[min(42vw,11rem)] rounded-full border border-[var(--kz-accent)] bg-[var(--kz-bg)] py-1.5 pl-3 pr-2 text-[14px] text-[var(--kz-fg)] outline-none placeholder:text-[var(--kz-fg-muted)]"
                />
                <button
                  type="submit"
                  className="kz-btn-primary !px-2.5 !py-1.5 text-[13px]"
                >
                  搜
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--kz-fg-muted)] hover:bg-[var(--kz-bg-hover)] hover:text-[var(--kz-fg)]"
                  aria-label="关闭搜索"
                  onClick={() => {
                    setMobileSearchOpen(false)
                    if (location.pathname !== '/search') setQ('')
                  }}
                >
                  <MenuIcon open />
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--kz-border)] bg-[var(--kz-bg-elevated)] text-[var(--kz-fg)] transition-colors hover:bg-[var(--kz-bg-hover)]"
                aria-label="搜索番剧"
                title="搜索"
                onClick={() => {
                  setMenuOpen(false)
                  setMobileSearchOpen(true)
                }}
              >
                <SearchIcon />
              </button>
            )}
          </div>

          <ThemeToggleButton />
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
