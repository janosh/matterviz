// ConvexHullInfoPane's composition probe across changes of the hull's composition keys
import type { CompositionType } from '#lib/composition/index.js'
import ConvexHull from '#lib/convex-hull/ConvexHull.svelte'
import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { expect, onTestFinished, test } from 'vite-plus/test'
import { doc_query, set_input } from '../setup'
import { make_phase } from '../test-fixtures'

const product = (idx: number): string | null =>
  document.querySelector(`[data-testid="probe-product-${idx}"]`)?.textContent ?? null

// LiCoO2 probed with O open is LiCo; without the open O it must be LiCoO2 again (the compound),
// not the stale LiCo (Li + Co). A host-set probe is the host's to change.
test(`a submitted probe is projected again when the open elements change`, async () => {
  const entries = [
    ...[`Li`, `Co`, `O`].map((element) => make_phase({ [element]: 1 }, 0)),
    make_phase({ Li: 1, Co: 1, O: 2 }, -3, { name: `compound` }),
  ]
  const props = $state<ComponentProps<typeof ConvexHull>>({
    entries,
    open_elements: { O: -3 },
    info_pane_open: true,
    probe_composition: null,
  })
  const component = mount(ConvexHull, { target: document.body, props })
  onTestFinished(() => unmount(component))
  await tick()
  set_input(doc_query<HTMLInputElement>(`.composition-probe input`), `LiCoO2`)
  doc_query<HTMLFormElement>(`.composition-probe`).requestSubmit()
  await tick()
  expect(props.probe_composition).toEqual({ Li: 1, Co: 1 })
  expect(product(0)).toBe(`compound 100%`)
  props.open_elements = { O: -2 } // a new μ alone keeps the projection
  flushSync()
  expect(props.probe_composition).toEqual({ Li: 1, Co: 1 })
  props.open_elements = undefined
  flushSync()
  expect(props.probe_composition).toEqual({ Li: 1, Co: 1, O: 2 })
  expect([product(0), product(1)]).toEqual([`compound 100%`, null])
  props.probe_composition = { Li: 1, Co: 1 }
  props.open_elements = { O: -3 }
  flushSync()
  expect(props.probe_composition).toEqual({ Li: 1, Co: 1 })
  // a host replacing the pane's probe owns it, even at the same coordinates
  set_input(doc_query<HTMLInputElement>(`.composition-probe input`), `LiCoO2`)
  doc_query<HTMLFormElement>(`.composition-probe`).requestSubmit()
  await tick()
  expect(product(0)).toBe(`compound 100%`)
  props.probe_composition = { Li: 1, Co: 1 }
  props.open_elements = undefined
  flushSync()
  expect(props.probe_composition).toEqual({ Li: 1, Co: 1 })
  // a host probe keyed like the entries (species keys included) is normalized and projected
  // through the open elements, as typed ones
  props.open_elements = { O: -3 }
  props.probe_composition = { Li: 1, 'Co3+': 1, O: 2 } as Record<
    string,
    number
  > as CompositionType
  flushSync()
  expect([product(0), product(1)]).toEqual([`compound 100%`, null])
  // a failed submission's error belongs to it: a host probe set since replaces it
  const probe_form = doc_query<HTMLFormElement>(`.composition-probe`)
  set_input(doc_query<HTMLInputElement>(`.composition-probe input`), `Qq2`)
  probe_form.requestSubmit()
  await tick()
  const alert = () => document.querySelector(`.probe-error`)?.textContent ?? null
  expect(alert()).toContain(`Can't parse Qq2`)
  props.probe_composition = { Li: 1, Co: 1 }
  flushSync()
  expect([alert(), product(0)]).toEqual([null, `compound 100%`])
  // the hull reprojects a submission with the info pane closed too
  set_input(doc_query<HTMLInputElement>(`.composition-probe input`), `LiCoO2`)
  probe_form.requestSubmit()
  await tick()
  props.enable_info_pane = false
  props.open_elements = undefined
  flushSync()
  expect(props.probe_composition).toEqual({ Li: 1, Co: 1, O: 2 })
})
