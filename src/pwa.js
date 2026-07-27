import { toast } from './ui/toast.js';

/**
 * Service worker registration plus the update handshake.
 *
 * When a new build lands we do not reload underneath someone mid-run — we tell
 * them, and let them take the update when they are ready.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env?.DEV) return; // the dev server serves fresh files anyway

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;

        installing.addEventListener('statechange', () => {
          // "installed" with a controller present means an update is waiting.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            toast('New version ready — reload to update.', { kind: 'info', ms: 6000 });
          }
        });
      });

      // Check for a new build when the app regains focus.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) registration.update().catch(() => {});
      });
    } catch (err) {
      console.warn('[pwa] service worker registration failed:', err);
    }
  });
}
