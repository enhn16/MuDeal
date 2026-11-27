export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "REPORT_ALREADY_PROCESSED"
  | "DEAL_EXPIRED"
  | "DAILY_REPORT_LIMIT_EXCEEDED"
  | "RATE_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR";

const STATUS_MAP: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  REPORT_ALREADY_PROCESSED: 409,
  DEAL_EXPIRED: 410,
  DAILY_REPORT_LIMIT_EXCEEDED: 429,
  RATE_LIMIT_EXCEEDED: 429,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = STATUS_MAP[code];
    this.details = details;
  }
}

export function jsonError(err: unknown, requestId: string = crypto.randomUUID()): Response {
  const appErr =
    err instanceof AppError
      ? err
      : new AppError("INTERNAL_ERROR", "요청을 처리하는 중 오류가 발생했습니다.");

  return Response.json(
    {
      error: {
        code: appErr.code,
        message: appErr.message,
        ...(appErr.details !== undefined ? { details: appErr.details } : {}),
        requestId,
      },
    },
    { status: appErr.status },
  );
}
