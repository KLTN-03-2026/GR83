import { request } from '../api/httpClient';
import { loadGoogleAuthApi } from './googleAuthLoader';

const googleScopes = 'openid email profile';
const globalWindow = window;

function createPromptError(code, reason) {
  const normalizedReason = reason ?? 'unknown';
  let message = 'Không thể khởi tạo Google Sign-In.';

  if (code === 'not_displayed') {
    message = `Google Sign-In không hiển thị (${normalizedReason}).`;
  } else if (code === 'skipped') {
    message = 'Đăng nhập bằng Google bị từ chối';
  } else if (code === 'dismissed') {
    message = `Google Sign-In đã đóng (${normalizedReason}).`;
  }

  const error = new Error(message);
  error.code = code;
  error.reason = normalizedReason;
  return error;
}

function createOauthError(code, rawCode) {
  const normalizedCode = rawCode ?? 'unknown';
  let message = `Google OAuth popup lỗi (${normalizedCode}).`;

  if (code === 'popup_failed_to_open') {
    message = 'Google OAuth popup lỗi (popup_failed_to_open). Trình duyệt đang chặn popup, hãy cho phép popup cho trang này rồi thử lại.';
  } else if (code === 'popup_closed') {
    message = 'Bạn đã đóng cửa sổ Google OAuth trước khi hoàn tất đăng nhập.';
  }

  const error = new Error(message);
  error.code = code;
  error.reason = normalizedCode;
  return error;
}

function shouldFallbackToOauth(error) {
  return error?.code === 'not_displayed' || error?.code === 'skipped';
}

function shouldFallbackToPrompt(error) {
  return error?.code === 'popup_failed_to_open' || error?.code === 'popup_closed';
}

function getGoogleClientId() {
  const clientId = import.meta.env.VITE_GOOGLE_AUTH_CLIENT_ID;

  if (!clientId) {
    throw new Error('Thiếu VITE_GOOGLE_AUTH_CLIENT_ID trong frontend/.env.');
  }

  return clientId;
}

function getGoogleCredentialByPrompt(google, clientId) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const complete = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;

      try {
        google.accounts.id.cancel();
      } catch {
        // noop
      }

      callback(value);
    };

    const resolveOnce = (credential) => complete(resolve, credential);
    const rejectOnce = (error) => complete(reject, error);

    google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => {
        const credential = response?.credential;

        if (!credential) {
          rejectOnce(new Error('Không nhận được credential từ Google.'));
          return;
        }

        resolveOnce(credential);
      },
      ux_mode: 'popup',
      auto_select: false,
      cancel_on_tap_outside: true,
      context: 'signin',
    });

    google.accounts.id.prompt((notification) => {
      if (notification?.isNotDisplayed?.()) {
        rejectOnce(createPromptError('not_displayed', notification.getNotDisplayedReason?.()));
        return;
      }

      if (notification?.isSkippedMoment?.()) {
        rejectOnce(createPromptError('skipped', notification.getSkippedReason?.()));
        return;
      }

      if (notification?.isDismissedMoment?.()) {
        const dismissedReason = notification.getDismissedReason?.();

        if (dismissedReason !== 'credential_returned') {
          rejectOnce(createPromptError('dismissed', dismissedReason));
        }
      }
    });
  });
}

function getGoogleAccessTokenByPopup(google, clientId) {
  if (!google.accounts?.oauth2?.initTokenClient) {
    throw new Error('Google OAuth2 API chưa sẵn sàng.');
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const resolveOnce = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    };

    const rejectOnce = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };

    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: googleScopes,
      callback: (tokenResponse) => {
        if (tokenResponse?.error) {
          rejectOnce(createOauthError(tokenResponse.error, tokenResponse.error));
          return;
        }

        const accessToken = typeof tokenResponse?.access_token === 'string' ? tokenResponse.access_token.trim() : '';

        if (!accessToken) {
          rejectOnce(new Error('Không nhận được access token từ Google.'));
          return;
        }

        resolveOnce(accessToken);
      },
      error_callback: (oauthError) => {
        const errorType = oauthError?.type ?? 'unknown';
        rejectOnce(createOauthError(errorType, errorType));
      },
    });

    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

async function getGoogleIdentity() {
  const clientId = getGoogleClientId();
  const hydratedGoogle = globalWindow.google;

  if (hydratedGoogle?.accounts?.oauth2?.initTokenClient) {
    try {
      const accessToken = await getGoogleAccessTokenByPopup(hydratedGoogle, clientId);
      return { accessToken };
    } catch (popupError) {
      if (!shouldFallbackToPrompt(popupError)) {
        throw popupError;
      }

      const credential = await getGoogleCredentialByPrompt(hydratedGoogle, clientId);
      return { credential };
    }
  }

  const google = await loadGoogleAuthApi();

  try {
    const credential = await getGoogleCredentialByPrompt(google, clientId);
    return { credential };
  } catch (promptError) {
    if (!shouldFallbackToOauth(promptError)) {
      throw promptError;
    }

    const accessToken = await getGoogleAccessTokenByPopup(google, clientId);
    return { accessToken };
  }
}

export const authService = {
  async warmupGoogleAuth() {
    await loadGoogleAuthApi();
  },

  async loginWithPassword(payload) {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async signupWithPassword(payload) {
    return request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async requestSignupVerificationCode(payload) {
    return request('/auth/signup/request-code', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async verifySignupVerificationCode(payload) {
    return request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async requestForgotPasswordCode(payload) {
    return request('/auth/forgot-password/request-code', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async verifyForgotPasswordCode(payload) {
    return request('/auth/forgot-password/verify-code', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async changePassword(payload) {
    return request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getProfile(payload) {
    const params = new URLSearchParams();

    if (payload?.accountId) {
      params.set('accountId', String(payload.accountId));
    }

    if (payload?.identifier) {
      params.set('identifier', String(payload.identifier));
    }

    return request(`/auth/profile?${params.toString()}`, {
      method: 'GET',
    });
  },

  async updateProfile(payload) {
    return request('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async uploadProfileAvatar(file, payload = {}) {
    const formData = new FormData();
    formData.append('avatar', file);

    if (payload.accountId) {
      formData.append('accountId', String(payload.accountId));
    }

    if (payload.identifier) {
      formData.append('identifier', String(payload.identifier));
    }

    return request('/auth/profile/avatar', {
      method: 'POST',
      body: formData,
    });
  },

  async loginWithGoogle() {
    const googleIdentity = await getGoogleIdentity();

    return request('/auth/google-login', {
      method: 'POST',
      body: JSON.stringify(googleIdentity),
    });
  },

  async signupWithGoogle() {
    const googleIdentity = await getGoogleIdentity();

    return request('/auth/google-signup', {
      method: 'POST',
      body: JSON.stringify(googleIdentity),
    });
  },
};
