import type { Vec2 } from '#lib/math'
import type { WulffFacetInput } from '#lib/wulff/index'
import { compute_wulff_shape, WulffFacetEditor } from '#lib/wulff/index'
import { flushSync, mount } from 'svelte'
import { expect, test } from 'vite-plus/test'
import { doc_query, set_input } from '../setup'
import { cubic_matrix } from '../test-fixtures'

const mount_editor = (
  initial: WulffFacetInput[],
  default_facets?: WulffFacetInput[],
  delta_mu_range?: Vec2,
) => {
  let facets = $state(initial)
  let delta_mu = $state(0)
  // null once the input is invalid, as WulffShape's bound output
  const wulff_data = $derived.by(() => {
    try {
      return compute_wulff_shape(cubic_matrix(2), facets, { delta_mu })
    } catch {
      return null
    }
  })
  mount(WulffFacetEditor, {
    target: document.body,
    props: {
      get facets() {
        return facets
      },
      set facets(value) {
        facets = value
      },
      get wulff_data() {
        return wulff_data
      },
      default_facets,
      get delta_mu() {
        return delta_mu
      },
      set delta_mu(value) {
        delta_mu = value
      },
      delta_mu_range,
    },
  })
  flushSync()
  return {
    get facets() {
      return facets
    },
    get delta_mu() {
      return delta_mu
    },
  }
}

test(`rows set γ and show area; reset restores the defaults; remove keeps the last row`, () => {
  const defaults: WulffFacetInput[] = [
    { miller: [1, 0, 0], energy: 1.234567 },
    { miller: [1, 1, 1], energy: 1 },
  ]
  const editor = mount_editor(structuredClone(defaults), defaults)
  const reset_btn = () =>
    document.querySelector<HTMLButtonElement>(`button[title="Reset surface energies"]`)
  expect(reset_btn()).toBeNull() // nothing edited yet
  const rows = document.querySelectorAll(`.wulff-facet-editor tbody tr`)
  expect([...rows].map((row) => row.querySelector(`th`)?.textContent?.trim())).toEqual([
    `{100}`,
    `{111}`,
  ])
  const number = doc_query<HTMLInputElement>(
    `input[aria-label="Surface energy of {100} (number)"]`,
  )
  expect(number.value).toBe(`1.235`) // 4 significant digits shown, γ kept in full
  set_input(doc_query<HTMLInputElement>(`input[aria-label="Surface energy of {111}"]`), `2.5`)
  flushSync()
  expect(editor.facets[1].energy).toBe(2.5)
  // γ111/γ100 > √3: {111} vanishes and the area column says so
  expect(rows[1].classList.contains(`absent`)).toBe(true)
  expect(rows[0].querySelector(`td.area`)?.textContent).toBe(`100%`)
  number.value = `0`
  number.dispatchEvent(new Event(`change`, { bubbles: true }))
  flushSync()
  expect(editor.facets[0].energy).toBe(1.234567) // non-positive γ is refused
  expect(number.value).toBe(`1.235`) // and the input shows the kept value again
  reset_btn()?.click()
  flushSync()
  expect(editor.facets).toEqual(defaults)
  expect(reset_btn()).toBeNull()
  doc_query<HTMLButtonElement>(`button[title="Remove {100}"]`).click()
  flushSync()
  expect(editor.facets.map(({ miller }) => miller)).toEqual([[1, 1, 1]])
  expect(doc_query<HTMLButtonElement>(`button[title="Remove {111}"]`).disabled).toBe(true)
})

// Any family with a positive γ is added: one equivalent to a listed one is
// compute_wulff_shape's to report, and rows keyed by position survive the duplicate. The
// very facet already listed can't be added again.
test.each([
  [`110`, `1.5`, true],
  [`010`, `1.5`, true],
  [`100`, `1.5`, false],
  [`110`, `0`, false],
])(`adding (%s) at γ = %s appends a row: %s`, (typed, energy, added) => {
  const editor = mount_editor([{ miller: [1, 0, 0], energy: 1 }])
  set_input(doc_query<HTMLInputElement>(`.add-family .miller-input input`), typed)
  set_input(doc_query<HTMLInputElement>(`.add-family input[type='number']`), energy)
  flushSync()
  expect(doc_query<HTMLButtonElement>(`.add-family button[type='submit']`).disabled).toBe(
    !added,
  )
  // submit the form as Enter or a click on Add would (the test DOM doesn't submit on click)
  doc_query(`form.add-family`).dispatchEvent(new Event(`submit`, { cancelable: true }))
  flushSync()
  expect(editor.facets).toHaveLength(added ? 2 : 1)
  expect(document.querySelectorAll(`.wulff-facet-editor tbody tr`)).toHaveLength(added ? 2 : 1)
})

// γ{111} = 1 + 0.5·Δμ falls below γ{100}/√3 at Δμ < -0.85: the cube's corners grow into an
// octahedron and {100} leaves the shape. Without a range there is no Δμ slider.
test.each([[[-1, 0] as Vec2], [undefined]])(`Δμ slider with range %j`, (delta_mu_range) => {
  const editor = mount_editor(
    [
      { miller: [1, 0, 0], energy: 1 },
      { miller: [1, 1, 1], energy: 1, slope: 0.5 },
    ],
    undefined,
    delta_mu_range,
  )
  const slider = document.querySelector<HTMLInputElement>(`.delta-mu input[type=range]`)
  const header = doc_query(`.wulff-facet-editor thead th[colspan]`).textContent
  if (!delta_mu_range) {
    expect([slider, header]).toEqual([null, `γ (J/m²)`])
    return
  }
  expect(header).toBe(`γ at Δμ = 0 (J/m²)`)
  expect(doc_query(`tbody tr:nth-child(2) th`).title).toBe(`dγ/dΔμ = 0.5 J/m² per eV`)
  set_input(doc_query<HTMLInputElement>(`.delta-mu input`), `-0.9`)
  flushSync()
  expect(editor.delta_mu).toBe(-0.9)
  expect(doc_query(`.delta-mu span`).textContent).toBe(`−0.90`) // format_num writes a true minus
  expect(doc_query(`tbody tr`).classList.contains(`absent`)).toBe(true)
  expect(editor.facets[1].energy).toBe(1) // γ at Δμ = 0 stays put
})
