// OpenNext owns the request pipeline; this thin entrypoint adds the application DO export
// required by Wrangler without changing the generated handler.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- generated only after Next type-checks
// @ts-ignore: .open-next/worker.js is generated after Next's type-check phase.
import openNextWorker from './.open-next/worker.js';

export { ProviderSchedulerDurableObject } from './lib/providerSchedulerDurableObject';

export default openNextWorker;
