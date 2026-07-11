import { extract_columns } from '$lib/file-viewer/plot-utils'
import { expect, test } from 'vitest'

test(`extract_columns tolerates null and non-object rows`, () => {
  const columns = extract_columns([{ value: 1 }, null, 42, `text`, { value: 2 }])

  expect(columns.get(`value`)).toEqual({
    values: [1, undefined, undefined, undefined, 2],
    type: `numeric`,
    n_valid: 2,
  })
})
