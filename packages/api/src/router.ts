import type { Env } from './helpers';
import { handleCors, addCorsHeaders } from './middleware/cors';
import {
  consumeRateLimit,
  getRateLimitHeaders,
  getClientIp,
} from './middleware/rate-limit';
import { getAuthenticatedAdmin } from './middleware/auth';
import { tooManyRequests } from './helpers';
import { handleHealth } from './routes/health';
import {
  handleListFeatureFlags,
  handleGetFeatureFlag,
  handleCreateFeatureFlag,
  handleUpdateFeatureFlag,
  handleDeleteFeatureFlag,
} from './routes/feature-flags';
import {
  handleListContacts,
  handleGetContact,
  handleCreateContact,
  handleUpdateContactStatus,
  handleDeleteContact,
} from './routes/contacts';
import {
  handleListAuditLogs,
} from './routes/audit-logs';
import {
  handleListConversations,
  handleGetConversation,
  handleCreateConversation,
  handleUpdateConversation,
  handleDeleteConversation,
  handleAddMessage,
} from './routes/conversations';
import {
  handleListApprovedComments,
  handleCreateComment,
  handleListAllComments,
  handleUpdateCommentStatus,
  handleDeleteComment,
} from './routes/comments';
import {
  handleToggleLike,
  handleGetLikeCount,
  handleListLikes,
} from './routes/likes';
import {
  handleListTodos,
  handleGetTodo,
  handleCreateTodo,
  handleUpdateTodo,
  handleDeleteTodo,
} from './routes/todos';
import {
  handleListScores,
  handleCreateScore,
  handleDeleteScore,
} from './routes/scores';
import { handleAdminLogin } from './routes/admin/admin-login';
import { handleAdminSession } from './routes/admin/admin-session';
import { handleAdminLogout } from './routes/admin/admin-logout';
import { handleAdminCollections } from './routes/admin/admin-collections';
import { handleAdminCollectionGet, handleAdminCollectionPost } from './routes/admin/admin-collection';
import { handleAdminProjects } from './routes/admin/admin-projects';
import { handleAdminBlogs } from './routes/admin/admin-blogs';
import { handleAdminBlogGet, handleAdminBlogPost, handleAdminBlogDelete } from './routes/admin/admin-blog';
import { handleAdminNotifications } from './routes/admin/admin-notifications';
import { handleAdminNotificationGet, handleAdminNotificationPost, handleAdminNotificationDelete } from './routes/admin/admin-notification';
import { handleAdminProjectVisibility } from './routes/admin/admin-project-visibility';
import { handleAdminCollectionVisibility } from './routes/admin/admin-collection-visibility';
import { handleAdminSortPersonalProjects } from './routes/admin/admin-sort-personal-projects';
import { adminHtml } from './routes/admin/admin-html';
import { handleDataFile } from './routes/data-file';
import { handleRoot } from './routes/root';
import { handleDocsDataApi } from './routes/docs-data-api';

type RouteHandler = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
  rateLimitCategory: 'auth' | 'read' | 'write';
  requiresAuth: boolean;
}

function extractParams(
  pattern: RegExp,
  pathname: string,
): Record<string, string> | null {
  const match = pattern.exec(pathname);
  if (!match) return null;
  return match.groups || {};
}

const routes: Route[] = [
  // Root landing page
  {
    method: 'GET',
    pattern: /^\/$/,
    handler: handleRoot,
    rateLimitCategory: 'read',
    requiresAuth: false,
  },
  // Admin panel (self-hosted)
  {
    method: 'GET',
    pattern: /^\/admin\/?$/,
    handler: () => new Response(adminHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    }),
    rateLimitCategory: 'read',
    requiresAuth: false,
  },
  // Docs (self-hosted)
  {
    method: 'GET',
    pattern: /^\/docs\/data-api\/?$/,
    handler: () => handleDocsDataApi(),
    rateLimitCategory: 'read',
    requiresAuth: false,
  },
  // Public data files (decrypt from GitHub, filter, serve)
  {
    method: 'GET',
    pattern: /^\/data\/(?<filename>[a-z0-9-]+\.json)$/,
    handler: (_r, env, _c, p) => handleDataFile(env, p.filename),
    rateLimitCategory: 'read',
    requiresAuth: false,
  },
  {
    method: 'GET',
    pattern: /^\/api\/health$/,
    handler: handleHealth,
    rateLimitCategory: 'read',
    requiresAuth: false,
  },

  // Feature flags
  {
    method: 'GET',
    pattern: /^\/api\/feature-flags\/(?<key>[^/]+)$/,
    handler: (_r, env, _c, p) => handleGetFeatureFlag(env, p.key),
    rateLimitCategory: 'read',
    requiresAuth: false,
  },
  {
    method: 'GET',
    pattern: /^\/api\/feature-flags$/,
    handler: (_r, env) => handleListFeatureFlags(env),
    rateLimitCategory: 'read',
    requiresAuth: false,
  },
  {
    method: 'POST',
    pattern: /^\/api\/feature-flags$/,
    handler: (r, env, _c, p) => handleCreateFeatureFlag(env, r, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/feature-flags\/(?<key>[^/]+)$/,
    handler: (r, env, _c, p) => handleUpdateFeatureFlag(env, p.key, r, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/feature-flags\/(?<key>[^/]+)$/,
    handler: (_r, env, _c, p) => handleDeleteFeatureFlag(env, p.key, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },

  // Contact submissions
  {
    method: 'GET',
    pattern: /^\/api\/contacts\/(?<id>[^/]+)$/,
    handler: (_r, env, _c, p) => handleGetContact(env, p.id),
    rateLimitCategory: 'read',
    requiresAuth: true,
  },
  {
    method: 'GET',
    pattern: /^\/api\/contacts$/,
    handler: (_r, env) => handleListContacts(env),
    rateLimitCategory: 'read',
    requiresAuth: true,
  },
  {
    method: 'POST',
    pattern: /^\/api\/contacts$/,
    handler: (r, env) => handleCreateContact(env, r),
    rateLimitCategory: 'write',
    requiresAuth: false,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/contacts\/(?<id>[^/]+)$/,
    handler: (r, env, _c, p) => handleUpdateContactStatus(env, p.id, r, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/contacts\/(?<id>[^/]+)$/,
    handler: (_r, env, _c, p) => handleDeleteContact(env, p.id, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },

  // Audit logs
  {
    method: 'GET',
    pattern: /^\/api\/audit-logs$/,
    handler: (_r, env) => handleListAuditLogs(env),
    rateLimitCategory: 'read',
    requiresAuth: true,
  },

  // Conversations
  {
    method: 'GET',
    pattern: /^\/api\/conversations\/(?<id>[^/]+)$/,
    handler: (_r, env, _c, p) => handleGetConversation(env, p.id),
    rateLimitCategory: 'read',
    requiresAuth: false,
  },
  {
    method: 'GET',
    pattern: /^\/api\/conversations$/,
    handler: (_r, env) => handleListConversations(env),
    rateLimitCategory: 'read',
    requiresAuth: false,
  },
  {
    method: 'POST',
    pattern: /^\/api\/conversations$/,
    handler: (r, env) => handleCreateConversation(env, r),
    rateLimitCategory: 'write',
    requiresAuth: false,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/conversations\/(?<id>[^/]+)$/,
    handler: (r, env, _c, p) => handleUpdateConversation(env, p.id, r, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/conversations\/(?<id>[^/]+)$/,
    handler: (_r, env, _c, p) => handleDeleteConversation(env, p.id, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },
  {
    method: 'POST',
    pattern: /^\/api\/conversations\/(?<id>[^/]+)\/messages$/,
    handler: (r, env, _c, p) => handleAddMessage(env, p.id, r),
    rateLimitCategory: 'write',
    requiresAuth: false,
  },

  // Comments
  {
    method: 'GET',
    pattern: /^\/api\/comments\/all$/,
    handler: (_r, env) => handleListAllComments(env),
    rateLimitCategory: 'read',
    requiresAuth: true,
  },
  {
    method: 'GET',
    pattern: /^\/api\/comments$/,
    handler: (r, env) => handleListApprovedComments(env, r),
    rateLimitCategory: 'read',
    requiresAuth: false,
  },
  {
    method: 'POST',
    pattern: /^\/api\/comments$/,
    handler: (r, env) => handleCreateComment(env, r),
    rateLimitCategory: 'write',
    requiresAuth: false,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/comments\/(?<id>[^/]+)$/,
    handler: (r, env, _c, p) => handleUpdateCommentStatus(env, p.id, r, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/comments\/(?<id>[^/]+)$/,
    handler: (_r, env, _c, p) => handleDeleteComment(env, p.id, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },

  // Likes
  {
    method: 'GET',
    pattern: /^\/api\/likes$/,
    handler: (_r, env) => handleListLikes(env),
    rateLimitCategory: 'read',
    requiresAuth: true,
  },
  {
    method: 'GET',
    pattern: /^\/api\/likes\/count$/,
    handler: (r, env) => handleGetLikeCount(env, r),
    rateLimitCategory: 'read',
    requiresAuth: false,
  },
  {
    method: 'POST',
    pattern: /^\/api\/likes\/toggle$/,
    handler: (r, env) => handleToggleLike(env, r),
    rateLimitCategory: 'write',
    requiresAuth: false,
  },

  // Todos
  {
    method: 'GET',
    pattern: /^\/api\/todos\/(?<id>[^/]+)$/,
    handler: (_r, env, _c, p) => handleGetTodo(env, p.id),
    rateLimitCategory: 'read',
    requiresAuth: true,
  },
  {
    method: 'GET',
    pattern: /^\/api\/todos$/,
    handler: (_r, env) => handleListTodos(env),
    rateLimitCategory: 'read',
    requiresAuth: true,
  },
  {
    method: 'POST',
    pattern: /^\/api\/todos$/,
    handler: (r, env, _c, p) => handleCreateTodo(env, r, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/todos\/(?<id>[^/]+)$/,
    handler: (r, env, _c, p) => handleUpdateTodo(env, p.id, r, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/todos\/(?<id>[^/]+)$/,
    handler: (_r, env, _c, p) => handleDeleteTodo(env, p.id, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },

  // Scores (game leaderboards)
  {
    method: 'GET',
    pattern: /^\/api\/scores$/,
    handler: (r, env) => handleListScores(env, r),
    rateLimitCategory: 'read',
    requiresAuth: false,
  },
  {
    method: 'POST',
    pattern: /^\/api\/scores$/,
    handler: (r, env, _c, p) => handleCreateScore(env, r, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/scores\/(?<id>[^/]+)$/,
    handler: (_r, env, _c, p) => handleDeleteScore(env, p.id, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },

  // ── Admin CMS routes ──

  // Session management
  {
    method: 'POST',
    pattern: /^\/api\/admin\/login$/,
    handler: (r, env) => handleAdminLogin(env, r),
    rateLimitCategory: 'auth',
    requiresAuth: false,
  },
  {
    method: 'GET',
    pattern: /^\/api\/admin\/session$/,
    handler: (r, env) => handleAdminSession(env, r),
    rateLimitCategory: 'read',
    requiresAuth: false,
  },
  {
    method: 'POST',
    pattern: /^\/api\/admin\/logout$/,
    handler: (r, env) => handleAdminLogout(env, r),
    rateLimitCategory: 'auth',
    requiresAuth: false,
  },

  // Collections list
  {
    method: 'GET',
    pattern: /^\/api\/admin\/collections$/,
    handler: (_r, env) => handleAdminCollections(env),
    rateLimitCategory: 'read',
    requiresAuth: true,
  },

  // Single collection file CRUD
  {
    method: 'GET',
    pattern: /^\/api\/admin\/collection\/(?<key>[^/]+)$/,
    handler: (_r, env, _c, p) => handleAdminCollectionGet(env, p.key),
    rateLimitCategory: 'read',
    requiresAuth: true,
  },
  {
    method: 'POST',
    pattern: /^\/api\/admin\/collection\/(?<key>[^/]+)$/,
    handler: (r, env, _c, p) => handleAdminCollectionPost(env, r, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },

  // Dashboard summary
  {
    method: 'GET',
    pattern: /^\/api\/admin\/projects$/,
    handler: (_r, env) => handleAdminProjects(env),
    rateLimitCategory: 'read',
    requiresAuth: true,
  },

  // Blog listing
  {
    method: 'GET',
    pattern: /^\/api\/admin\/blogs$/,
    handler: (_r, env) => handleAdminBlogs(env),
    rateLimitCategory: 'read',
    requiresAuth: true,
  },

  // Single blog CRUD
  {
    method: 'GET',
    pattern: /^\/api\/admin\/blogs\/(?<slug>[^/]+)$/,
    handler: (_r, env, _c, p) => handleAdminBlogGet(env, p.slug),
    rateLimitCategory: 'read',
    requiresAuth: true,
  },
  {
    method: 'POST',
    pattern: /^\/api\/admin\/blogs\/(?<slug>[^/]+)$/,
    handler: (r, env, _c, p) => handleAdminBlogPost(env, r, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/admin\/blogs\/(?<slug>[^/]+)$/,
    handler: (r, env, _c, p) => handleAdminBlogDelete(env, r, p.__admin, p.slug),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },

  // Notification listing
  {
    method: 'GET',
    pattern: /^\/api\/admin\/notifications$/,
    handler: (_r, env) => handleAdminNotifications(env),
    rateLimitCategory: 'read',
    requiresAuth: true,
  },

  // Single notification CRUD
  {
    method: 'GET',
    pattern: /^\/api\/admin\/notifications\/(?<slug>[^/]+)$/,
    handler: (_r, env, _c, p) => handleAdminNotificationGet(env, p.slug),
    rateLimitCategory: 'read',
    requiresAuth: true,
  },
  {
    method: 'POST',
    pattern: /^\/api\/admin\/notifications\/(?<slug>[^/]+)$/,
    handler: (r, env, _c, p) => handleAdminNotificationPost(env, r, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/admin\/notifications\/(?<slug>[^/]+)$/,
    handler: (r, env, _c, p) => handleAdminNotificationDelete(env, r, p.__admin, p.slug),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },

  // Visibility mutations
  {
    method: 'POST',
    pattern: /^\/api\/admin\/project-visibility$/,
    handler: (r, env, _c, p) => handleAdminProjectVisibility(env, r, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },
  {
    method: 'POST',
    pattern: /^\/api\/admin\/collection-visibility$/,
    handler: (r, env, _c, p) => handleAdminCollectionVisibility(env, r, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },

  // Sort
  {
    method: 'POST',
    pattern: /^\/api\/admin\/sort-personal-projects$/,
    handler: (r, env, _c, p) => handleAdminSortPersonalProjects(env, r, p.__admin),
    rateLimitCategory: 'write',
    requiresAuth: true,
  },
];

export async function router(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Handle CORS preflight
  const corsResponse = handleCors(request, env);
  if (corsResponse) return corsResponse;

  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  // Find matching route
  const route = routes.find((r) => {
    if (r.method !== method) return false;
    return r.pattern.test(pathname);
  });

  if (!route) {
    const response = new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
    return addCorsHeaders(response, env);
  }

  // Rate limiting
  const ip = getClientIp(request);
  const rateLimitResult = consumeRateLimit(ip, route.rateLimitCategory, env);

  if (!rateLimitResult.ok) {
    return tooManyRequests(rateLimitResult.retryAfter);
  }

  // Auth check — resolve admin before handler so write routes can audit-log
  let admin: { username: string } | null = null;
  if (route.requiresAuth) {
    admin = await getAuthenticatedAdmin(env, request.headers);
    if (!admin) {
      const response = new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          status: 401,
          headers: { 'content-type': 'application/json' },
        },
      );
      return addCorsHeaders(response, env);
    }
  }

  // Extract params and call handler
  const params = extractParams(route.pattern, pathname) || {};
  if (admin) {
    params['__admin'] = admin.username;
  }
  const response = await route.handler(request, env, ctx, params);

  // Add CORS headers and rate limit headers
  const rateLimitHeaders = getRateLimitHeaders(rateLimitResult, route.rateLimitCategory);
  const corsResponse2 = addCorsHeaders(response, env);
  for (const [key, value] of Object.entries(rateLimitHeaders)) {
    corsResponse2.headers.set(key, value);
  }

  return corsResponse2;
}
