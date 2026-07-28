/// <reference types="vite/client" />

/**
 * Build-time public branding (footer / about).
 * Set in repo-root `.env` or `apps/web/.env` — must be prefixed with VITE_.
 */
interface ImportMetaEnv {
  /** Source repo URL or `owner/repo` (default: uerax/Animaku) */
  readonly VITE_GITHUB_URL?: string
  /** Button label (default: GitHub) */
  readonly VITE_GITHUB_LABEL?: string
  /** Product display name (default: Animaku) */
  readonly VITE_PRODUCT_NAME?: string
  /** Short tagline under the name */
  readonly VITE_SITE_TAGLINE?: string
  /** Maintainer display name — shown in “维护” row when set */
  readonly VITE_MAINTAINER_NAME?: string
  /** Maintainer profile URL (GitHub user, blog, …) */
  readonly VITE_MAINTAINER_URL?: string
  /** Extra homepage / docs / status page */
  readonly VITE_HOMEPAGE_URL?: string
  readonly VITE_HOMEPAGE_LABEL?: string
  /** Contact email — mailto link in footer */
  readonly VITE_CONTACT_EMAIL?: string
  /** Optional free-form note under tagline */
  readonly VITE_FOOTER_NOTE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
