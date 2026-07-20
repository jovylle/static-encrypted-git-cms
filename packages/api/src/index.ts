import { router } from './router';

export interface Env {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_SESSION_SECRET?: string;
  ADMIN_SESSION_TTL_SECONDS?: string;
  CORS_ORIGIN: string;
  CONTENT_DECRYPT_KEY?: string;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  GITHUB_BRANCH?: string;
  ADMIN_GITHUB_WRITE_MODE?: string;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return router(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
