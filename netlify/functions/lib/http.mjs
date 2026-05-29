export function jsonResponse(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

export function methodNotAllowed(allowed) {
  return jsonResponse(405, { error: 'Method not allowed' }, { allow: allowed });
}

export function badRequest(message) {
  return jsonResponse(400, { error: message });
}

export function unauthorized(message = 'Unauthorized') {
  return jsonResponse(401, { error: message });
}

export function serverError(message = 'Internal server error') {
  return jsonResponse(500, { error: message });
}

export function parseJsonBody(event) {
  if (!event?.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw new Error('Invalid JSON body');
  }
}
