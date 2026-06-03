/**
 * Backward-compatible Agent search endpoint.
 *
 * The main Agent stream is `/api/agent/chat`. This route only maps the old
 * `{ query }` request shape to `{ message }` and delegates to the chat route
 * so there is one runtime/session implementation to maintain.
 */

import { POST as chatPOST } from '../chat/route';

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'Invalid request parameters' }, 400);
  }

  const requestBody = body as Record<string, unknown>;
  const message = typeof requestBody.query === 'string'
    ? requestBody.query
    : requestBody.message;
  const mappedBody = {
    ...requestBody,
    message,
  };
  delete (mappedBody as Record<string, unknown>).query;

  return chatPOST(new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(mappedBody),
  }));
}

export async function GET() {
  return jsonResponse({ error: 'Method not allowed' }, 405);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
