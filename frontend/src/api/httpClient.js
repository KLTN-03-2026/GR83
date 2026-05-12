const rawApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api').trim();
const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawApiBaseUrl);
const isLocalTarget = /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(rawApiBaseUrl);
const baseWithScheme = hasScheme
  ? rawApiBaseUrl
  : `${isLocalTarget ? 'http' : 'https'}://${rawApiBaseUrl}`;
const normalizedApiBaseUrl = baseWithScheme.replace(/\/+$/, '');
const apiBaseUrl = /\/api$/i.test(normalizedApiBaseUrl)
  ? normalizedApiBaseUrl
  : `${normalizedApiBaseUrl}/api`;

export async function request(path, options = {}) {
  let response;
  const isFormDataBody = options.body instanceof FormData;

  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      headers: isFormDataBody
        ? { ...(options.headers ?? {}) }
        : {
            'Content-Type': 'application/json',
            ...(options.headers ?? {}),
          },
      cache: options.cache ?? 'no-store',
      signal: options.signal,
      ...options,
    });
  } catch (error) {
    const networkError = new Error(
      `Không thể kết nối tới API (${apiBaseUrl}). Vui lòng kiểm tra backend đang chạy và cấu hình CORS.`,
    );
    networkError.cause = error;
    throw networkError;
  }

  let responseBody = null;

  if (response.status !== 204) {
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      responseBody = await response.json();
    } else {
      const responseText = await response.text();
      responseBody = responseText ? { message: responseText } : null;
    }
  }

  if (!response.ok) {
    const error = new Error(responseBody?.message ?? `Request failed with status ${response.status}`);
    error.status = response.status;
    error.body = responseBody;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return responseBody;
}
