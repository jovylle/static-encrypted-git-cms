import { jsonResponse } from '../helpers';

export function handleHealth(): Response {
  return jsonResponse({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
}
