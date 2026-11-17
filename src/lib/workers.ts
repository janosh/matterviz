// Global controls for the Web Workers behind every `compute_*_async` client and the client
// type they share (`.cancel` / `.mount` and the per-request `signal` / `on_progress` options)
export { check_blob_workers, disable_workers } from './worker-client.svelte'
export type { WorkerClient, WorkerRequestOptions } from './worker-client.svelte'
