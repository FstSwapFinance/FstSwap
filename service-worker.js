// Retire the legacy app's service worker after replacing the repository contents.
// No fetch handler: subsequent navigations use the new static site directly.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.registration.unregister()));
