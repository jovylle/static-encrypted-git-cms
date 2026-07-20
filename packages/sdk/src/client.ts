import type {
  FeatureFlag, ContactSubmission, Conversation, Message, Comment,
  LikeToggle, LikeCount, Todo, AuditLog, HealthStatus, DeleteResponse,
} from './types';

type AdminCredentials = { username: string; password: string };

function basicAuth({ username, password }: AdminCredentials): string {
  return 'Basic ' + btoa(`${username}:${password}`);
}

export class ApiClient {
  private baseUrl: string;
  private adminAuth?: string;

  constructor(options: { baseUrl: string; admin?: AdminCredentials }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    if (options.admin) {
      this.adminAuth = basicAuth(options.admin);
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    admin = false,
  ): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (admin && this.adminAuth) {
      headers['authorization'] = this.adminAuth;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json() as T & { error?: string };
    if (!res.ok) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return json;
  }

  // Health
  health(): Promise<HealthStatus> {
    return this.request('GET', '/api/health');
  }

  // Feature flags
  listFeatureFlags(): Promise<FeatureFlag[]> {
    return this.request('GET', '/api/feature-flags');
  }

  getFeatureFlag(key: string): Promise<FeatureFlag> {
    return this.request('GET', `/api/feature-flags/${encodeURIComponent(key)}`);
  }

  createFeatureFlag(data: { key: string; enabled?: boolean; description?: string }): Promise<FeatureFlag> {
    return this.request('POST', '/api/feature-flags', data, true);
  }

  updateFeatureFlag(key: string, data: { enabled?: boolean; description?: string }): Promise<FeatureFlag> {
    return this.request('PUT', `/api/feature-flags/${encodeURIComponent(key)}`, data, true);
  }

  deleteFeatureFlag(key: string): Promise<DeleteResponse> {
    return this.request('DELETE', `/api/feature-flags/${encodeURIComponent(key)}`, undefined, true);
  }

  // Contacts
  submitContact(data: { name: string; email: string; subject?: string; message: string }): Promise<ContactSubmission> {
    return this.request('POST', '/api/contacts', data);
  }

  listContacts(): Promise<ContactSubmission[]> {
    return this.request('GET', '/api/contacts', undefined, true);
  }

  getContact(id: string): Promise<ContactSubmission> {
    return this.request('GET', `/api/contacts/${id}`, undefined, true);
  }

  updateContactStatus(id: string, status: string): Promise<ContactSubmission> {
    return this.request('PUT', `/api/contacts/${id}`, { status }, true);
  }

  deleteContact(id: string): Promise<DeleteResponse> {
    return this.request('DELETE', `/api/contacts/${id}`, undefined, true);
  }

  // Conversations
  listConversations(): Promise<Conversation[]> {
    return this.request('GET', '/api/conversations');
  }

  getConversation(id: string): Promise<Conversation> {
    return this.request('GET', `/api/conversations/${id}`);
  }

  createConversation(data: { title?: string; message: string }): Promise<Conversation> {
    return this.request('POST', '/api/conversations', data);
  }

  updateConversation(id: string, data: { title: string }): Promise<Conversation> {
    return this.request('PUT', `/api/conversations/${id}`, data, true);
  }

  deleteConversation(id: string): Promise<DeleteResponse> {
    return this.request('DELETE', `/api/conversations/${id}`, undefined, true);
  }

  addMessage(conversationId: string, data: { role?: string; content: string }): Promise<Message> {
    return this.request('POST', `/api/conversations/${conversationId}/messages`, data);
  }

  // Comments
  listApprovedComments(targetType: string, targetId: string): Promise<Comment[]> {
    return this.request('GET', `/api/comments?target_type=${encodeURIComponent(targetType)}&target_id=${encodeURIComponent(targetId)}`);
  }

  createComment(data: { target_type: string; target_id: string; author_name: string; author_email?: string; content: string }): Promise<Comment> {
    return this.request('POST', '/api/comments', data);
  }

  listAllComments(): Promise<Comment[]> {
    return this.request('GET', '/api/comments/all', undefined, true);
  }

  updateCommentStatus(id: string, status: 'approved' | 'rejected' | 'spam'): Promise<Comment> {
    return this.request('PUT', `/api/comments/${id}`, { status }, true);
  }

  deleteComment(id: string): Promise<DeleteResponse> {
    return this.request('DELETE', `/api/comments/${id}`, undefined, true);
  }

  // Likes
  toggleLike(data: { target_type: string; target_id: string; visitor_id: string }): Promise<LikeToggle> {
    return this.request('POST', '/api/likes/toggle', data);
  }

  getLikeCount(targetType: string, targetId: string): Promise<LikeCount> {
    return this.request('GET', `/api/likes/count?target_type=${encodeURIComponent(targetType)}&target_id=${encodeURIComponent(targetId)}`);
  }

  // Todos
  listTodos(): Promise<Todo[]> {
    return this.request('GET', '/api/todos', undefined, true);
  }

  getTodo(id: string): Promise<Todo> {
    return this.request('GET', `/api/todos/${id}`, undefined, true);
  }

  createTodo(data: { title: string; content?: string; status?: string; priority?: number }): Promise<Todo> {
    return this.request('POST', '/api/todos', data, true);
  }

  updateTodo(id: string, data: { title?: string; content?: string; status?: string; priority?: number }): Promise<Todo> {
    return this.request('PUT', `/api/todos/${id}`, data, true);
  }

  deleteTodo(id: string): Promise<DeleteResponse> {
    return this.request('DELETE', `/api/todos/${id}`, undefined, true);
  }

  // Audit logs
  listAuditLogs(): Promise<AuditLog[]> {
    return this.request('GET', '/api/audit-logs', undefined, true);
  }
}
