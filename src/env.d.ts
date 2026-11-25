/// <reference types="@vinext/types/next" />

declare module "vinext/server/app-router-entry" {
  const entry: {
    fetch: (request: Request, env: unknown, ctx?: ExecutionContext) => Promise<Response>;
    __ensureInstrumentation?: (ctx?: ExecutionContext) => Promise<void>;
  };
  export default entry;
}

export interface CloudflareEnv {
  DB: D1Database;
  EVIDENCE_BUCKET: R2Bucket;
  OCR_DAILY_LIMIT: string;
  KOPIS_API_KEY?: string;
  KAKAO_CLIENT_ID?: string;
  KAKAO_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  JWT_SECRET?: string;
  ADMIN_OAUTH_EMAILS?: string;
  GEMINI_API_KEY?: string;
}
