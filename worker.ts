// OpenNext owns the request pipeline; this thin entrypoint adds the application DO export
// required by Wrangler without changing the generated handler.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- generated only after Next type-checks
// @ts-ignore: .open-next/worker.js is generated after Next's type-check phase.
import openNextWorker from './.open-next/worker.js';
import { redirectPublicHttpToHttps } from './lib/httpsRedirect';
import { fetchWithClientAbortBridge } from './lib/workerClientAbort';

export { ProviderSchedulerDurableObject } from './lib/providerSchedulerDurableObject';

export default {
  ...openNextWorker,
  async fetch(
    request: Request,
    env: Parameters<typeof openNextWorker.fetch>[1],
    ctx: Parameters<typeof openNextWorker.fetch>[2]
  ) {
    const redirect = redirectPublicHttpToHttps(request);
    if (redirect) return redirect;
    if (request.method === 'POST' && new URL(request.url).pathname === '/api/agent/chat') {
      return fetchWithClientAbortBridge(openNextWorker.fetch, request, env, ctx);
    }
    return openNextWorker.fetch(request, env, ctx);
  },
};
