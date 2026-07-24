import clsx from 'clsx'

/** Right-side fold affordance for 视频源 / 选集 headers. */
export function WatchCollapseChevron({ open }: { open: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--kz-border)] bg-[var(--kz-bg-soft)] text-[var(--kz-fg-muted)] transition-colors',
        open && 'border-[var(--kz-accent)]/35 text-[var(--kz-accent)]',
      )}
      aria-hidden
      title={open ? '点击收起' : '点击展开'}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        className={clsx('transition-transform duration-200', open && 'rotate-180')}
      >
        <path
          d="M4 6.2L8 10.2L12 6.2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
