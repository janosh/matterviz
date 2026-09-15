import LazyDemo from '$site/LazyDemo.svelte'
import CodeExample from '$site/CodeExample.svelte'
import { createRawSnippet, flushSync, mount, tick, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import StatusMessage from 'svelte-widgets/StatusMessage.svelte'
import { trigger_intersection } from '../environment'
import { doc_query } from '../setup'

test(`defers loading until visible, loads once and forwards reactive props`, async () => {
  const result = Promise.withResolvers<{
    default: typeof StatusMessage
    props: { message: string }
  }>()
  const load = vi.fn(() => result.promise)
  const props = $state({ label: `Test demo`, load, props: { message: `Current message` } })
  const component = mount(LazyDemo, { target: document.body, props })
  onTestFinished(() => unmount(component))
  flushSync()
  const region = doc_query(`.lazy-demo`)
  trigger_intersection(region, false)
  await tick()
  expect(load).not.toHaveBeenCalled()
  expect(region.textContent).toBe(`Test demo`)

  trigger_intersection(region, true)
  await tick()
  expect(load).toHaveBeenCalledOnce()
  expect(region.querySelector(`[role="status"]`)?.textContent).toBe(`Loading Test demo…`)
  result.resolve({ default: StatusMessage, props: { message: `Loaded default` } })
  await vi.waitFor(() => expect(region.textContent).toContain(`Current message`))
  props.props.message = `Updated message`
  await tick()
  expect(region.textContent).toContain(`Updated message`)
  expect(load).toHaveBeenCalledOnce()
})

test(`reports a failed import with the demo name`, async () => {
  const load = vi.fn(() => Promise.reject(new Error(`Module unavailable`)))
  const component = mount(LazyDemo, {
    target: document.body,
    props: { label: `Phonon spectra`, load, props: {} },
  })
  onTestFinished(() => unmount(component))
  await vi.waitFor(() => {
    expect(doc_query(`[role="alert"]`).textContent).toContain(
      `Failed to load Phonon spectra: Module unavailable`,
    )
  })
})

test.each([true, false])(
  `documentation keeps source accessible and mounts its example once (collapsible=%s)`,
  async (collapsible) => {
    const cleanup = vi.fn()
    const setup = vi.fn((element: Element) => {
      const button = element.querySelector(`button`)
      if (!button) throw new Error(`Missing example button`)
      button.addEventListener(`click`, () => (button.textContent = `Changed`))
      return cleanup
    })
    const component = mount(CodeExample, {
      target: document.body,
      props: {
        src: `Example source`,
        meta: { collapsible, id: `example-anchor` },
        example: createRawSnippet(() => ({
          render: () => `<div><button>Change</button></div>`,
          setup,
        })),
      },
    })
    flushSync()
    const region = doc_query(`.lazy-demo`)
    trigger_intersection(region, false)
    await tick()
    expect(setup).not.toHaveBeenCalled()
    expect(doc_query(`#example-anchor pre`).textContent).toContain(`Example source`)
    expect(doc_query(`pre`).classList.contains(`open`)).toBe(!collapsible)
    if (collapsible) {
      doc_query<HTMLButtonElement>(`nav > button`).click()
      await tick()
      expect(doc_query(`pre`).classList.contains(`open`)).toBe(true)
    }

    trigger_intersection(region, true)
    await tick()
    expect(setup).toHaveBeenCalledOnce()
    doc_query(`.lazy-demo button`).click()
    expect(() => trigger_intersection(region, false)).toThrow(
      `no IntersectionObserver is observing the given element`,
    )
    await tick()
    expect(region.textContent).toBe(`Changed`)
    expect(setup).toHaveBeenCalledOnce()
    await unmount(component)
    expect(cleanup).toHaveBeenCalledOnce()
  },
)
