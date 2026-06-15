// Minimal Backbone-like model mimicking anywidget's AnyModel: set() mutates state
// and (like Backbone) synchronously emits change:<key> to JS listeners, which is
// exactly the echo path the bridge's loop-guards must absorb. Cast to the bridge's
// AnyModel param via each test's local `as_model` (derived from a bridge value it
// already imports, since `anywidget/types` isn't a repo-root dependency).
export class MockModel {
  state: Record<string, unknown>
  listeners: Record<string, Set<() => void>> = {}
  save_count = 0
  set_count = 0
  constructor(initial: Record<string, unknown> = {}) {
    this.state = { ...initial }
  }
  get(key: string): unknown {
    return this.state[key]
  }
  set(key: string, value: unknown): void {
    this.set_count += 1
    this.state[key] = value
    this.listeners[`change:${key}`]?.forEach((fn) => fn())
  }
  // simulate a trait update arriving from Python
  push_from_python(key: string, value: unknown): void {
    this.state[key] = value
    this.listeners[`change:${key}`]?.forEach((fn) => fn())
  }
  on(event: string, fn: () => void): void {
    ;(this.listeners[event] ??= new Set()).add(fn)
  }
  off(event: string, fn: () => void): void {
    this.listeners[event]?.delete(fn)
  }
  save_changes(): void {
    this.save_count += 1
  }
}
