const globalWindow = window;
const promiseKey = '__smartrideGoogleMapsPromise';
const callbackKey = '__smartrideGoogleMapsInit';
const loadTimeoutMs = 10000;

export function loadGoogleMapsApi() {
  if (globalWindow.google?.maps) {
    return Promise.resolve(globalWindow.google);
  }

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return Promise.reject(new Error('Thiếu VITE_GOOGLE_MAPS_API_KEY trong frontend/.env để tải Google Maps.'));
  }

  if (globalWindow[promiseKey]) {
    return globalWindow[promiseKey];
  }

  const existingScript = document.querySelector('script[data-google-maps="true"]');

  if (existingScript) {
    existingScript.remove();
  }

  globalWindow[promiseKey] = new Promise((resolve, reject) => {
    const previousAuthFailure = globalWindow.gm_authFailure;
    let script = null;
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }

      if (script) {
        script.remove();
      }

      delete globalWindow[promiseKey];
      delete globalWindow[callbackKey];
      globalWindow.gm_authFailure = previousAuthFailure;
    };

    const resolveWithCleanup = (value) => {
      cleanup();
      resolve(value);
    };

    const rejectWithCleanup = (error) => {
      cleanup();
      reject(error);
    };

    globalWindow[callbackKey] = () => {
      resolveWithCleanup(globalWindow.google);
    };

    globalWindow.gm_authFailure = () => {
      rejectWithCleanup(new Error('Google Maps authentication failed. Kiểm tra billing và hạn chế key.'));

      if (typeof previousAuthFailure === 'function') {
        previousAuthFailure();
      }
    };

    timeoutId = window.setTimeout(() => {
      rejectWithCleanup(new Error('Google Maps loading timed out.'));
    }, loadTimeoutMs);

    script = document.createElement('script');
    script.dataset.googleMaps = 'true';
    script.async = true;
    script.defer = true;
    script.referrerPolicy = 'origin';
    script.onerror = () => {
      rejectWithCleanup(new Error('Không thể tải Google Maps. Kiểm tra key, billing và quyền truy cập API.'));
    };
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&libraries=places&v=weekly&language=vi&region=VN&loading=async&auth_referrer_policy=origin&callback=${callbackKey}`;

    document.head.appendChild(script);
  });

  return globalWindow[promiseKey];
}