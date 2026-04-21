const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api';

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
