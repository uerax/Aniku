import { getSiteBranding } from '../lib/site-branding'

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  )
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.5V20h12V9.5" />
    </svg>
  )
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m5 8 7 5.5L19 8" />
    </svg>
  )
}

const iconBtn =
  'inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--kz-fg-muted)] transition-colors hover:bg-[var(--kz-bg-hover)] hover:text-[var(--kz-fg)]'

/**
 * Compact site footer inspired by product sites like 48.club:
 * single row — brand/copyright left, icon links right. No tagline / legal blurb.
 * Hidden on watch routes by Layout.
 */
export function SiteFooter() {
  const b = getSiteBranding()
  const year = new Date().getFullYear()

  const maintainerLabel = b.maintainerName
    ? b.maintainerName
    : b.maintainerUrl
      ? hostLabel(b.maintainerUrl)
      : ''

  return (
    <footer className="border-t border-[var(--kz-border)]">
      <div className="mx-auto flex max-w-[1760px] flex-col items-center justify-between gap-3 px-4 py-5 sm:flex-row sm:px-5 sm:py-6 lg:px-6">
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px] text-[var(--kz-fg-muted)] sm:justify-start">
          <span className="font-medium tracking-tight text-[var(--kz-fg)]">
            {b.productName}
          </span>
          <span className="text-[var(--kz-border)]" aria-hidden>
            ·
          </span>
          <span>© {year}</span>
          {maintainerLabel ? (
            <>
              <span className="text-[var(--kz-border)]" aria-hidden>
                ·
              </span>
              {b.maintainerUrl ? (
                <a
                  href={b.maintainerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-[var(--kz-fg)]"
                >
                  {maintainerLabel}
                </a>
              ) : (
                <span>{maintainerLabel}</span>
              )}
            </>
          ) : null}
          {b.extraNote ? (
            <>
              <span className="text-[var(--kz-border)]" aria-hidden>
                ·
              </span>
              <span className="text-[var(--kz-fg-dim)]">{b.extraNote}</span>
            </>
          ) : null}
        </div>

        <nav
          aria-label="社交与联系"
          className="flex items-center gap-0.5"
        >
          <a
            href={b.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={iconBtn}
            title={b.githubLabel}
            aria-label={`${b.productName} ${b.githubLabel}`}
          >
            <GitHubIcon />
          </a>
          {b.homepageUrl ? (
            <a
              href={b.homepageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={iconBtn}
              title={b.homepageLabel}
              aria-label={b.homepageLabel}
            >
              <HomeIcon />
            </a>
          ) : null}
          {b.contactEmail ? (
            <a
              href={`mailto:${b.contactEmail}`}
              className={iconBtn}
              title={b.contactEmail}
              aria-label={`邮件 ${b.contactEmail}`}
            >
              <MailIcon />
            </a>
          ) : null}
        </nav>
      </div>
    </footer>
  )
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url.replace(/^https?:\/\//, '')
  }
}
