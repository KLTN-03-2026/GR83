export function errorHandler(error, request, response, next) {
  console.error(error);

  const statusCode = Number.isInteger(error?.statusCode)
    ? error.statusCode
    : Number.isInteger(error?.status)
      ? error.status
      : error?.type === 'entity.too.large'
        ? 413
        : 500;

  const message =
    statusCode === 413
      ? 'Dữ liệu gửi lên quá lớn. Vui lòng giảm kích thước ảnh hoặc thử lại với dữ liệu ngắn hơn.'
      : statusCode >= 500
        ? 'Internal Server Error'
        : error?.message || 'Bad Request';

  response.status(statusCode).json({
    success: false,
    message,
  });
}
