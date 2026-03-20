/* ═══════════════════════════════════════════════════════════════════════════
   PPSC — Service Worker (Web Push notifications)
   ═══════════════════════════════════════════════════════════════════════════ */

self.addEventListener('push', (event) => {
  let payload = { title: 'Ping Pong Social Club', body: 'Queue update', url: '/' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {}

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body:      payload.body,
      icon:      '/logo.png',
      badge:     '/logo.png',
      tag:       'ppsc-queue',   // replaces previous notification
      renotify:  true,            // vibrate/sound even if same tag
      data:      { url: payload.url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Focus an existing tab for this URL if possible
      for (const client of list) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
