// Basic Service Worker scaffold: sync event will post to server for queued transactions.
self.addEventListener('install', event => {
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-transactions') {
    event.waitUntil(syncQueuedTransactions());
  }
});

async function syncQueuedTransactions(){
  // Service worker has limited access to IndexedDB in some contexts.
  // We post a message to window clients to trigger the sync from page context instead.
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: 'SYNC_QUEUED_TRANSACTIONS' });
  }
}
