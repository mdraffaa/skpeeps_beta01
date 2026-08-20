(function () {
  'use strict';

  const INSTALLATION_KEY = 'skp_web_push_installation_id';

  function isIos() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches === true ||
      window.navigator.standalone === true;
  }

  function isSupported() {
    return 'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
  }

  function baseScopePath() {
    return new URL('.', document.baseURI).pathname;
  }

  function serviceWorkerPath() {
    return new URL('skp-push-sw.js', document.baseURI).pathname;
  }

  function getInstallationId() {
    let id = localStorage.getItem(INSTALLATION_KEY);
    if (id) return id;

    if (globalThis.crypto?.randomUUID) {
      id = globalThis.crypto.randomUUID();
    } else {
      id = `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    localStorage.setItem(INSTALLATION_KEY, id);
    return id;
  }

  async function ensureRegistration() {
    if (!isSupported()) throw new Error('WEB_PUSH_UNSUPPORTED');

    const scope = baseScopePath();
    let registration = await navigator.serviceWorker.getRegistration(scope);
    if (!registration || !registration.active?.scriptURL?.includes('skp-push-sw.js')) {
      registration = await navigator.serviceWorker.register(serviceWorkerPath(), {
        scope,
        updateViaCache: 'none',
      });
    }
    return navigator.serviceWorker.ready;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  function payloadForSubscription(subscription) {
    if (!subscription) return null;
    const json = subscription.toJSON();
    return {
      subscribed: true,
      endpoint: json.endpoint || '',
      p256dh: json.keys?.p256dh || '',
      auth: json.keys?.auth || '',
      installationId: getInstallationId(),
      userAgent: navigator.userAgent || '',
      isIos: isIos(),
    };
  }

  async function getExistingSubscription() {
    if (!isSupported()) return null;
    const registration = await navigator.serviceWorker.getRegistration(baseScopePath());
    if (!registration) return null;
    return registration.pushManager.getSubscription();
  }

  async function getStateJson() {
    if (!isSupported()) {
      return JSON.stringify({
        supported: false,
        isIos: isIos(),
        isStandalone: isStandalone(),
        permission: 'unsupported',
        subscribed: false,
        installationId: getInstallationId(),
      });
    }

    const subscription = await getExistingSubscription();
    return JSON.stringify({
      supported: true,
      isIos: isIos(),
      isStandalone: isStandalone(),
      permission: Notification.permission,
      subscribed: !!subscription,
      installationId: getInstallationId(),
    });
  }

  async function currentSubscriptionJson() {
    const subscription = await getExistingSubscription();
    const payload = payloadForSubscription(subscription);
    return JSON.stringify(payload || {
      subscribed: false,
      installationId: getInstallationId(),
      isIos: isIos(),
    });
  }

  async function subscribeJson(vapidPublicKey) {
    if (!isSupported()) throw new Error('WEB_PUSH_UNSUPPORTED');
    if (isIos() && !isStandalone()) throw new Error('IOS_HOME_SCREEN_REQUIRED');

    // IMPORTANT: call requestPermission synchronously from the user's button
    // gesture before awaiting anything, as required by iOS Web Push.
    const permissionPromise = Notification.permission === 'default'
      ? Notification.requestPermission()
      : Promise.resolve(Notification.permission);

    const permission = await permissionPromise;
    if (permission !== 'granted') {
      throw new Error(permission === 'denied'
        ? 'NOTIFICATION_PERMISSION_DENIED'
        : 'NOTIFICATION_PERMISSION_NOT_GRANTED');
    }

    const registration = await ensureRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    return JSON.stringify(payloadForSubscription(subscription));
  }

  async function unsubscribeJson() {
    const subscription = await getExistingSubscription();
    const installationId = getInstallationId();
    if (subscription) await subscription.unsubscribe();
    return JSON.stringify({
      unsubscribed: true,
      installationId,
      isIos: isIos(),
    });
  }

  async function preRegister() {
    if (!isSupported()) return;
    try {
      await ensureRegistration();
    } catch (e) {
      console.debug('[SKP Web Push] pre-register skipped:', e);
    }
  }

  window.SKPWebPush = {
    getStateJson,
    currentSubscriptionJson,
    subscribeJson,
    unsubscribeJson,
    preRegister,
  };

  // Registration itself needs no permission and makes the later user gesture
  // path much faster, especially on iOS Home Screen web apps.
  preRegister();
})();
