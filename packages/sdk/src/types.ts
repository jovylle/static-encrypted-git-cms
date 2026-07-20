export interface FeatureFlag {
  id: string;
  key: string;
  enabled: number;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface ContactSubmission {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: 'unread' | 'read' | 'replied' | 'spam';
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages?: Message[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface Comment {
  id: string;
  target_type: string;
  target_id: string;
  author_name: string;
  author_email?: string;
  content: string;
  status: 'pending' | 'approved' | 'rejected' | 'spam';
  created_at: string;
}

export interface LikeToggle {
  liked: boolean;
  count: number;
}

export interface LikeCount {
  target_type: string;
  target_id: string;
  count: number;
}

export interface Todo {
  id: string;
  title: string;
  content: string;
  status: 'open' | 'in_progress' | 'done';
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface HealthStatus {
  status: string;
  timestamp: string;
  version: string;
}

export interface ApiError {
  error: string;
}

export interface DeleteResponse {
  deleted: true;
}
