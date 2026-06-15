// @vitest-environment happy-dom
import { flushSync, mount } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  next_event_id,
  reactive_widget,
  set_model,
  throttle,
} from '../../extensions/anywidget/reactive.svelte'
import { MockModel } from './anywidget-mock-model'
import Harness from './reactive-mount-harness.svelte'

// Derive AnyModel from an imported bridge value (set_model is used at runtime
// below) rather than importing `anywidget/types`, which isn't a repo-root dep.
const as_model = (mock: MockModel) => mock as unknown as Parameters<typeof set_model>[0]

describe(`set_model`, () => {
  test(`writes + flushes only when the value changed`, () => {
    const model = new MockModel({ foo: 1 })
    set_model(as_model(model), `foo`, 1) // unchanged -> no-op
    expect(model.set_count).toBe(0)
    expect(model.save_count).toBe(0)

    set_model(as_model(model), `foo`, 2)
    expect(model.state.foo).toBe(2)
    expect(model.save_count).toBe(1)
  })

  test(`treats undefined and null as equal (no spurious write)`, () => {
    const model = new MockModel({ foo: null })
    set_model(as_model(model), `foo`, undefined)
    expect(model.set_count).toBe(0)
  })

  test.each([
    [{ a: 1 }, { a: 1 }, false],
    [{ a: 1 }, { a: 2 }, true],
    [[1, 2], [1, 2], false],
    [[1, 2], [1, 3], true],
  ])(`structural equality %o vs %o -> writes=%s`, (initial, next, should_write) => {
    const model = new MockModel({ foo: initial })
    set_model(as_model(model), `foo`, next)
    expect(model.set_count).toBe(should_write ? 1 : 0)
  })
})

describe(`next_event_id`, () => {
  test(`starts at 1 for unset/null and increments off the current value`, () => {
    const model = new MockModel({})
    expect(next_event_id(as_model(model), `active_point`)).toBe(1)

    model.state.active_point = { point_idx: 2, event_id: 7 }
    expect(next_event_id(as_model(model), `active_point`)).toBe(8)
  })

  test(`makes repeated identical clicks distinct trait values`, () => {
    // models the bridge's click callback: same point twice still changes the trait
    const model = new MockModel({})
    const click = (point_idx: number) =>
      set_model(as_model(model), `active_point`, {
        point_idx,
        event_id: next_event_id(as_model(model), `active_point`),
      })
    click(1)
    const first = model.state.active_point
    click(1) // same point again
    expect(model.set_count).toBe(2) // both writes went through
    expect(model.state.active_point).not.toEqual(first) // distinct event_id
  })
})

describe(`reactive_widget`, () => {
  test(`seeds props from model traits + merges extra`, () => {
    const model = new MockModel({ a: 1, b: `x` })
    const cb = () => {}
    const { props } = reactive_widget(as_model(model), [`a`, `b`], [], { on_click: cb })
    expect(props.a).toBe(1)
    expect(props.b).toBe(`x`)
    expect(props.on_click).toBe(cb)
  })

  test(`drive: Python trait change propagates into props`, () => {
    const model = new MockModel({ current_step_idx: 0 })
    const { props } = reactive_widget(as_model(model), [`current_step_idx`])
    model.push_from_python(`current_step_idx`, 7)
    expect(props.current_step_idx).toBe(7)
  })

  test(`omits undefined drive keys at mount (component uses fallback)`, () => {
    // null/missing traits must be omitted, else Svelte's props_invalid_value
    // fires for $bindable-with-fallback props passed undefined via $state.
    const model = new MockModel({ defined: 1, missing: null })
    const { props } = reactive_widget(as_model(model), [`defined`, `missing`])
    expect(props.defined).toBe(1)
    expect(`missing` in props).toBe(false)
  })

  test(`drive: clearing a trait deletes the key to revert to fallback`, () => {
    const model = new MockModel({ x_axis: { label: `E` } })
    const { props } = reactive_widget(as_model(model), [`x_axis`])
    expect(props.x_axis).toEqual({ label: `E` })
    model.push_from_python(`x_axis`, null)
    expect(`x_axis` in props).toBe(false) // reverted to component fallback
  })

  test(`writeback keys are seeded (undefined -> null) so binding is established`, () => {
    const model = new MockModel({ hovered_site_idx: null })
    const { props } = reactive_widget(
      as_model(model),
      [`hovered_site_idx`],
      [`hovered_site_idx`],
    )
    expect(`hovered_site_idx` in props).toBe(true)
    expect(props.hovered_site_idx).toBeNull()
  })

  test(`drive: clearing a writeback key keeps it bound (reverts to null)`, () => {
    const model = new MockModel({ hovered_site_idx: 4 })
    const { props } = reactive_widget(
      as_model(model),
      [`hovered_site_idx`],
      [`hovered_site_idx`],
    )
    expect(props.hovered_site_idx).toBe(4)
    model.push_from_python(`hovered_site_idx`, null)
    expect(`hovered_site_idx` in props).toBe(true) // still bound
    expect(props.hovered_site_idx).toBeNull()
  })

  test(`writeback: mutating props pushes to model + saves`, () => {
    const model = new MockModel({ selected_sites: [] })
    const { props } = reactive_widget(as_model(model), [`selected_sites`], [`selected_sites`])
    flushSync() // initial writeback effect: value equals model -> no write
    expect(model.save_count).toBe(0)

    props.selected_sites = [3]
    flushSync()
    expect(model.state.selected_sites).toEqual([3])
    expect(model.save_count).toBe(1)
  })

  test(`two-way sync does not loop (Python -> JS -> Python echo absorbed)`, () => {
    const model = new MockModel({ current_step_idx: 0 })
    const { props } = reactive_widget(
      as_model(model),
      [`current_step_idx`],
      [`current_step_idx`],
    )
    flushSync()
    const baseline_saves = model.save_count

    // Python pushes a new step; drive updates props, writeback must not echo back
    model.push_from_python(`current_step_idx`, 5)
    flushSync()
    expect(props.current_step_idx).toBe(5)
    expect(model.save_count).toBe(baseline_saves) // no echo write

    // Local (component-style) mutation writes back exactly once
    props.current_step_idx = 9
    flushSync()
    expect(model.state.current_step_idx).toBe(9)
    expect(model.save_count).toBe(baseline_saves + 1)
  })

  test(`dispose unregisters drive listeners`, () => {
    const model = new MockModel({ a: 0 })
    const { props, dispose } = reactive_widget(as_model(model), [`a`])
    dispose()
    model.push_from_python(`a`, 42)
    expect(props.a).toBe(0) // listener removed -> no update
  })

  // Exercises the real path the whole feature relies on: reactive_widget().props
  // passed into Svelte's mount(), a component $bindable mutation flowing back to
  // the model, and a Python push flowing into the component.
  test(`real mount(): $bindable writeback -> model, and drive -> component`, () => {
    const model = new MockModel({ current_step_idx: 0 })
    const reactive = reactive_widget(
      as_model(model),
      [`current_step_idx`],
      [`current_step_idx`],
    )
    const target = document.createElement(`div`)
    document.body.append(target)
    const inst = mount(Harness, { target, props: reactive.props }) as unknown as {
      step: () => void
    }
    flushSync()
    expect(model.save_count).toBe(0) // initial writeback is a no-op

    inst.step() // component mutates $bindable 0 -> 1
    flushSync()
    expect(model.state.current_step_idx).toBe(1)
    expect(model.save_count).toBe(1)

    model.push_from_python(`current_step_idx`, 5) // Python -> component
    flushSync()
    inst.step() // proves the driven value reached the component: 5 -> 6
    flushSync()
    expect(model.state.current_step_idx).toBe(6)

    reactive.dispose()
  })

  // Proves the delete-on-clear path reverts a *real* component to its $bindable
  // fallback (not just that the props object lost the key, as the unit test above
  // checks). This is the headless-render crash the omit/delete logic prevents.
  test(`real mount(): clearing a drive-only trait reverts the component to its fallback`, () => {
    const model = new MockModel({ current_step_idx: 5 })
    const reactive = reactive_widget(as_model(model), [`current_step_idx`]) // drive-only
    const target = document.createElement(`div`)
    document.body.append(target)
    mount(Harness, { target, props: reactive.props })
    flushSync()
    expect(target.querySelector(`span`)?.textContent).toBe(`5`)

    model.push_from_python(`current_step_idx`, null) // clear -> delete -> fallback
    flushSync()
    expect(`current_step_idx` in reactive.props).toBe(false)
    expect(target.querySelector(`span`)?.textContent).toBe(`0`) // component fallback

    reactive.dispose()
  })
})

describe(`throttle`, () => {
  beforeEach(() => vi.useRealTimers())

  test(`fires leading call immediately, coalesces trailing burst`, () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const throttled = throttle(fn, 100)
    throttled(1) // leading -> immediate
    throttled(2)
    throttled(3) // coalesced into trailing
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith(1)
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith(3) // latest queued args win
    vi.useRealTimers()
  })

  test(`cancel() drops the pending trailing call`, () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const throttled = throttle(fn, 100)
    throttled(1) // leading
    throttled(2) // queued
    throttled.cancel()
    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(1) // trailing call was cancelled
    vi.useRealTimers()
  })

  test(`drops stale trailing call when a newer call fires immediately`, () => {
    // if the event loop stalls past the window, a fresh immediate call must
    // cancel the older queued trailing call so stale data can't fire after it
    vi.useFakeTimers()
    const fn = vi.fn()
    const throttled = throttle(fn, 100)
    const t0 = Date.now()
    throttled(1) // leading -> immediate
    throttled(2) // queued (trailing timer pending)
    vi.setSystemTime(t0 + 500) // clock jumps past the window without running timers
    throttled(3) // newer call fires immediately
    vi.runAllTimers() // flush any leftover timer
    expect(fn.mock.calls.map((call) => call[0])).toEqual([1, 3]) // no stale 2 after 3
    vi.useRealTimers()
  })
})
