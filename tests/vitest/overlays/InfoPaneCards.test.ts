import InfoPaneCards from '$lib/overlays/InfoPaneCards.svelte'
import { mount } from 'svelte'
import { expect, test } from 'vitest'

test(`renders duplicate unkeyed rows`, () => {
  mount(InfoPaneCards, {
    target: document.body,
    props: {
      cards: [
        {
          title: `Card`,
          rows: [
            { label: `Same`, value: `Value` },
            {
              label: `Same`,
              value: `Value`,
            },
          ],
        },
      ],
      filter_placeholder: `Filter info`,
      empty_label: `info`,
    },
  })

  expect(document.querySelectorAll(`.info-row`)).toHaveLength(2)
})
