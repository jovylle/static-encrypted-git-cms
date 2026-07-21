interface D1TableDef {
  key: string;
  label: string;
  apiPath: string;
  readOnly: boolean;
}

const D1_TABLES: D1TableDef[] = [
  { key: 'feature_flags', label: 'Feature Flags', apiPath: '/api/feature-flags', readOnly: true },
  { key: 'contact_submissions', label: 'Contact Submissions', apiPath: '/api/contacts', readOnly: true },
  { key: 'conversations', label: 'Conversations', apiPath: '/api/conversations', readOnly: true },
  { key: 'comments', label: 'Comments', apiPath: '/api/comments/all', readOnly: true },
  { key: 'todos', label: 'Todos', apiPath: '/api/todos', readOnly: true },
  { key: 'likes', label: 'Likes', apiPath: '/api/likes', readOnly: true },
  { key: 'audit_logs', label: 'Audit Log', apiPath: '/api/audit-logs', readOnly: true },
];

const byKey = new Map(D1_TABLES.map((item) => [item.key, item]));

export function listD1Tables(): D1TableDef[] {
  return D1_TABLES.map((t) => ({ ...t }));
}

export function getD1TableByKey(key: string): D1TableDef | null {
  return byKey.get(String(key || '').trim()) || null;
}
