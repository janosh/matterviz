// @vitest-environment happy-dom
import { flushSync, mount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  derived_prop,
  drive_prop,
  drive_props,
  next_event_id,
  reactive_widget,
  set_model,
  throttle,
  writeback_prop,
} from '../../extensions/anywidget/reactive.svelte'
import { MockModel } from './anywidget-mock-model'
import Harness from './reactive-mount-harness.svelte'

// Derive AnyModel from an imported bridge value (set_model is used at runtime
// below) rather than importing `anywidget/types`, which isn't a repo-root dep.
const as_model = (mock: MockModel) => mock as unknown as Parameters<typeof set_model>[0]

describe(`set_model`, () => {
  test.each([
    [1, 1, false],
    [1, 2, true],
    [null, undefined, false], // undefined and null are equal: no spurious write
    [{ a: 1 }, { a: 1 }, false],
    [{ a: 1 }, { a: 2 }, true],
    [[1, 2], [1, 2], false],
    [[1, 2], [1, 3], true],
  ])(`%o -> %o writes + saves only on change (%s)`, (initial, next, should_write) => {
    const model = new MockModel({ foo: initial })
    set_model(as_model(model), `foo`, next)
    expect(model.set_count).toBe(should_write ? 1 : 0)
    expect(model.save_count).toBe(should_write ? 1 : 0)
    if (should_write) expect(model.state.foo).toEqual(next)
  })
})

// repeated identical clicks becoming distinct trait values is covered end-to-end by
// anywidget-renderers' scatter_plot point callback test
test(`next_event_id starts at 1 for unset/null and increments off the current value`, () => {
  const model = new MockModel({})
  expect(next_event_id(as_model(model), `active_point`)).toBe(1)
  model.state.active_point = { point_idx: 2, event_id: 7 }
  expect(next_event_id(as_model(model), `active_point`)).toBe(8)
})

describe(`reactive_widget`, () => {
  test(`seeds props from driven specs, merges extra and follows Python changes`, () => {
    const model = new MockModel({ a: 1, b: `x` })
    const callback_fn = () => {}
    const { props } = reactive_widget(as_model(model), drive_props([`a`, `b`]), {
      on_click: callback_fn,
    })
    expect(props).toEqual({ a: 1, b: `x`, on_click: callback_fn })
    model.push_from_python(`a`, 7)
    expect(props.a).toBe(7)
  })

  test(`derived: recomputes when any dep trait changes`, () => {
    const model = new MockModel({ a: 1, b: 2 })
    const { props } = reactive_widget(as_model(model), [
      derived_prop(`combo`, [`a`, `b`], (mdl) => ({ a: mdl.get(`a`), b: mdl.get(`b`) })),
    ])
    expect(props.combo).toEqual({ a: 1, b: 2 })
    model.push_from_python(`b`, 9)
    expect(props.combo).toEqual({ a: 1, b: 9 })
  })

  test(`omits null drive keys at mount and deletes cleared ones (component uses fallback)`, () => {
    // null/missing traits must be omitted, else Svelte's props_invalid_value
    // fires for $bindable-with-fallback props passed undefined via $state.
    const model = new MockModel({ defined: { label: `E` }, missing: null })
    const { props } = reactive_widget(as_model(model), drive_props([`defined`, `missing`]))
    expect(props.defined).toEqual({ label: `E` })
    expect(`missing` in props).toBe(false)
    model.push_from_python(`defined`, null)
    expect(`defined` in props).toBe(false)
  })

  // the seeded fallback equals the model-derived value, so nothing is written before
  // interaction, and the prop is bound with its fallback (null would crash .length)
  test.each([{ selected_sites: null }, {}])(
    `writeback prop for %o is seeded with its fallback without saving`,
    (state) => {
      const model = new MockModel(state)
      const { props } = reactive_widget(as_model(model), [
        writeback_prop(`selected_sites`, []),
      ])
      flushSync()
      expect(props.selected_sites).toEqual([])
      expect(model.set_count).toBe(0)
      expect(model.save_count).toBe(0)
    },
  )

  test(`drive: clearing a writeback prop keeps it bound (reverts to fallback)`, () => {
    const model = new MockModel({ hovered_site_idx: 4 })
    const { props } = reactive_widget(as_model(model), [writeback_prop(`hovered_site_idx`)])
    expect(props.hovered_site_idx).toBe(4)
    model.push_from_python(`hovered_site_idx`, null)
    expect(`hovered_site_idx` in props).toBe(true) // still bound
    expect(props.hovered_site_idx).toBeNull() // no fallback given -> null
  })

  test(`dispose unregisters drive listeners and stops writeback effects`, () => {
    const model = new MockModel({ a: 0, current_step_idx: 0 })
    const { props, dispose } = reactive_widget(as_model(model), [
      drive_prop(`a`),
      writeback_prop(`current_step_idx`, 0),
    ])
    flushSync()
    dispose()
    model.push_from_python(`a`, 42)
    expect(props.a).toBe(0)
    props.current_step_idx = 9
    flushSync()
    expect(model.state.current_step_idx).toBe(0)
    expect(model.save_count).toBe(0)
  })

  // Exercises the real path the whole feature relies on: reactive_widget().props
  // passed into Svelte's mount(), a component $bindable mutation flowing back to
  // the model exactly once, and a Python push flowing into the component without
  // echoing back (Python -> JS -> Python loop absorbed).
  test(`real mount(): $bindable writeback -> model, and drive -> component`, () => {
    const model = new MockModel({ current_step_idx: 0 })
    const reactive = reactive_widget(as_model(model), [writeback_prop(`current_step_idx`, 0)])
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
    expect(model.save_count).toBe(1) // the driven value is not echoed back
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
    const reactive = reactive_widget(as_model(model), [drive_prop(`current_step_idx`)]) // drive-only
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
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test(`fires leading call immediately, coalesces trailing burst`, () => {
    const callback = vi.fn()
    const throttled = throttle(callback, 100)
    throttled(1) // leading -> immediate
    throttled(2)
    throttled(3) // coalesced into trailing
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenLastCalledWith(1)
    vi.advanceTimersByTime(100)
    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenLastCalledWith(3) // latest queued args win
  })

  test(`cancel() drops the pending trailing call`, () => {
    const callback = vi.fn()
    const throttled = throttle(callback, 100)
    throttled(1) // leading
    throttled(2) // queued
    throttled.cancel()
    vi.advanceTimersByTime(200)
    expect(callback).toHaveBeenCalledTimes(1) // trailing call was cancelled
  })

  test(`drops stale trailing call when a newer call fires immediately`, () => {
    // if the event loop stalls past the window, a fresh immediate call must
    // cancel the older queued trailing call so stale data can't fire after it
    const callback = vi.fn()
    const throttled = throttle(callback, 100)
    const param_0 = Date.now()
    throttled(1) // leading -> immediate
    throttled(2) // queued (trailing timer pending)
    vi.setSystemTime(param_0 + 500) // clock jumps past the window without running timers
    throttled(3) // newer call fires immediately
    vi.runAllTimers() // flush any leftover timer
    expect(callback.mock.calls.map((call) => call[0])).toEqual([1, 3]) // no stale 2 after 3
  })
})
