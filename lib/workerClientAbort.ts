type FetchHandler<Env, Context> = (
  request: Request,
  env: Env,
  context: Context
) => Promise<Response>;

/**
 * Bridges cancellation of an OpenNext streaming response back into the signal
 * seen by the Next route handler. OpenNext's generated response stream does
 * not define a cancel callback, so a disconnected SSE client otherwise cannot
 * abort provider requests that are already in flight.
 */
export async function fetchWithClientAbortBridge<Env, Context>(
  handler: FetchHandler<Env, Context>,
  request: Request,
  env: Env,
  context: Context
): Promise<Response> {
  const clientAbort = new AbortController();
  const abortFromRequest = (): void => clientAbort.abort(request.signal.reason);
  const detach = (): void => request.signal.removeEventListener('abort', abortFromRequest);

  if (request.signal.aborted) {
    abortFromRequest();
  } else {
    request.signal.addEventListener('abort', abortFromRequest, { once: true });
  }

  const routeRequest = new Request(request, { signal: clientAbort.signal });
  const response = await handler(routeRequest, env, context);
  if (!response.body) {
    detach();
    return response;
  }

  const source = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await source.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        detach();
        controller.error(error);
      }
    },
    async cancel(reason) {
      clientAbort.abort();
      detach();
      await source.cancel(reason);
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
