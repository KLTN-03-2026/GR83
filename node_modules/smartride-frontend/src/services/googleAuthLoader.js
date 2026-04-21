const globalWindow = window;
const promiseKey = '__smartrideGoogleAuthPromise';
const loadTimeoutMs = 12000;

export function loadGoogleAuthApi() {
  if (globalWindow.google?.accounts?.id) {
    return Promise.resolve(globalWindow.google);
  }

  if (globalWindow[promiseKey]) {
    return globalWindow[promiseKey];
  }

  const existingScript = document.querySelector('script[data-google-auth="true"]');

  if (existingScript) {
    existingScript.remove();
  }

  globalWindow[promiseKey] = new Promise((resolve, reject) => {
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
    };

    const resolveWithCleanup = (value) => {
      cleanup();
      resolve(value);
    };

    const rejectWithCleanup = (error) => {
      cleanup();
      reject(error);
    };

    timeoutId = window.setTimeout(() => {
      rejectWithCleanup(new Error('Google Sign-In loading timed out.'));
    }, loadTimeoutMs);

    script = document.createElement('script');
    script.dataset.googleAuth = 'true';
    script.async = true;
    script.defer = true;
    script.src = 'https://accounts.google.com/gsi/client';

    script.onload = () => {
      if (!globalWindow.google?.accounts?.id) {
        rejectWithCleanup(new Error('Google Sign-In SDK loaded but unavailable.'));
        return;
      }

      resolveWithCleanup(globalWindow.google);
    };

    script.onerror = () => {
      rejectWithCleanup(new Error('Không thể tải Google Sign-In SDK.'));
    };

    document.head.appendChild(script);
  });

  return globalWindow[promiseKey];
}
