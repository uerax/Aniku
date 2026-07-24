/**
 * /play/:id — same unified WatchPage as /subject/:id.
 * Classic layout was removed: subject always used WatchPage, so the setting
 * only affected resume deep-links and was effectively dead.
 */
export { WatchPage as PlayPage } from './WatchPage'
