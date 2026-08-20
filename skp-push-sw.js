/* SK Peeps standards-based Web Push service worker. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'SK Peeps';
  const options = {
    body: data.body || '',
    icon: data.icon || 'icons/Icon-192.png',
    badge: data.badge || 'icons/Icon-192.png',
    tag: data.tag || buildTag(data),
    renotify: false,
    data: {
      route: normalizeRoute(data.route || routeForData(data)),
    },
  };

  // Safari requires a visible notification for every received push event.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = normalizeRoute(event.notification.data?.route || '/notifications');
  event.waitUntil(openFlutterRoute(route));
});

function normalizeRoute(route) {
  const raw = String(route || '/notifications');
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function routeForData(data) {
  const type = String(data.type || '');
  const postId = String(data.postId || '');
  const uid = String(data.uid || '');
  const chatId = String(data.chatId || '');

  if (type === 'groupChat' && chatId) return `/group/${chatId}`;
  if (type === 'chat' && uid) return `/chat/${uid}`;
  if (type === 'profileVisit' && uid) return `/profile/${uid}`;
  if (postId) return `/post/${postId}`;
  return '/notifications';
}

function buildTag(data) {
  if (data.type === 'groupChat' && data.chatId) return `group_chat_${data.chatId}`;
  if (data.type === 'chat' && data.uid) return `chat_${data.uid}`;
  return `skp_${data.type || 'social'}_${data.postId || Date.now()}`;
}

async function openFlutterRoute(route) {
  const scopeUrl = new URL(self.registration.scope);
  const basePath = scopeUrl.pathname.endsWith('/')
    ? scopeUrl.pathname
    : `${scopeUrl.pathname}/`;

  // SKP currently uses Flutter's default hash URL strategy.
  const target = new URL(
    `${basePath}#${normalizeRoute(route)}`,
    scopeUrl.origin,
  ).href;

  const windows = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  for (const client of windows) {
    try {
      if ('navigate' in client) await client.navigate(target);
      return await client.focus();
    } catch (_) {
      // iOS can briefly expose an inert WindowClient after notification click.
      // Fall through to openWindow.
    }
  }

  return self.clients.openWindow(target);
}
