// Worker-side half of the create_worker_client protocol (see worker-client.svelte.ts): each
// request arrives as `{ id, input, options }`, any number of `{ id, progress }` messages may
// follow, and exactly one `{ id, result, error }` reply ends it. A request that cannot be
// deserialized never reaches `message`, so `messageerror` answers with `{ id: null, error }`
// and the client fails every pending request rather than leaving one awaiting forever. Kept
// apart from the client so worker bundles do not pull Svelte runtime code.
// Dedicated workers' postMessage takes no targetOrigin (that is Window.postMessage), so
// unicorn's require-post-message-target-origin is a false positive here.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
import { to_error } from '$lib/utils'

type WorkerRequest<Input, Options> = { id: number; input: Input; options: Options }

// The compute callback's own parameter types drive the request type; both `Input` and
// `Options` are inferred from it, so they are not unnecessary despite appearing once.
// `options` is `undefined` when the caller omitted them, exactly as the client's
// `compute_sync` receives it, so one `options = {}` parameter serves both paths.
// oxlint-disable-next-line typescript-eslint/no-unnecessary-type-parameters
export function serve_worker<Input, Options, Result>(
  compute: (
    input: Input,
    options: Options | undefined,
    report_progress: (progress: unknown) => void,
  ) => Result,
  // Buffers inside `result` to move rather than copy back to the main thread
  transferables: (result: Result) => Transferable[] = () => [],
): void {
  self.addEventListener(
    `message`,
    ({ data: { id, input, options } }: MessageEvent<WorkerRequest<Input, Options>>) => {
      try {
        const result = compute(input, options, (progress) =>
          self.postMessage({ id, progress }),
        )
        self.postMessage({ id, result, error: null }, { transfer: transferables(result) })
      } catch (err) {
        self.postMessage({ id, result: null, error: to_error(err).message })
      }
    },
  )
  self.addEventListener(`messageerror`, () => {
    self.postMessage({
      id: null,
      result: null,
      error: `worker received a request that could not be deserialized`,
    })
  })
}
