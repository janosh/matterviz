import AnalysisSummary from '#lib/trajectory/AnalysisSummary.svelte'
import { createRawSnippet } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import { fire, form_controls, mount_in_test, set_input, settle } from '../setup'

test(`downloads build data only on click and follow the edited export name`, async () => {
  const download = vi.fn() // svelte-widgets' download() defers to a global one when present
  vi.stubGlobal(`download`, download)
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
  const columns = vi.fn(() => ({ t_ps: [0, 1], msd_A2: [0, 2.5] }))
  const json = vi.fn(() => ({ analysis: `msd` }))
  const target = mount_in_test(AnalysisSummary, {
    headers: [`Species`],
    downloads: [
      { label: `MSD CSV`, filename: `msd.csv`, columns },
      { label: `Analysis JSON`, filename: `analysis.json`, json },
    ],
    children: createRawSnippet(() => ({ render: () => `<tr><td>Cu</td></tr>` })),
    note: createRawSnippet(() => ({ render: () => `<span>4 frames</span>` })),
  })
  const name_input = form_controls(target).control(`File name`)
  if (!(name_input instanceof HTMLInputElement)) throw new Error(`File name is not an input`)
  // the first download names the export
  expect(name_input.value).toBe(`msd`)
  expect([columns, json].map((builder) => builder.mock.calls.length)).toEqual([0, 0])

  const [csv_button, json_button] = target.querySelectorAll<HTMLButtonElement>(
    `button.analysis-download`,
  )
  set_input(name_input, `run-1`)
  await fire(csv_button)
  await vi.waitFor(() => expect(download).toHaveBeenCalledOnce())
  expect(download).toHaveBeenLastCalledWith(`t_ps,msd_A2\n0,0\n1,2.5`, `run-1.csv`, `text/csv`)
  await settle() // the export stays busy (buttons disabled) until the save resolves

  // a filename outside the first one's stem is appended to the export name
  await fire(json_button)
  await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2))
  expect(download).toHaveBeenLastCalledWith(
    `{\n  "analysis": "msd"\n}`,
    `run-1-analysis.json`,
    `application/json`,
  )
  await settle()

  set_input(name_input, `a/b`)
  await settle()
  expect([csv_button.disabled, json_button.disabled]).toEqual([true, true])
})
