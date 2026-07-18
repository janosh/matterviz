import { create_site_search_loader, type SiteSearchAction } from '$site/search'
import { normalize_static_url } from '$site/state.svelte'
import { describe, expect, test, vi } from 'vitest'

const make_route_action = (url: string): SiteSearchAction => ({
  id: `route:${url}`,
  label: url,
  description: `Open page`,
  url,
  action: vi.fn(),
})

describe(`site search`, () => {
  test.each([
    [`/phase-diagram.html#section`, `/phase-diagram#section`],
    [`/plot/histogram.html?bins=20`, `/plot/histogram?bins=20`],
    [`/index.html#overview`, `/#overview`],
    [`https://matterviz.janosh.dev/structure.html`, `https://matterviz.janosh.dev/structure`],
    [`/already-extensionless`, `/already-extensionless`],
  ])(`normalizes %s`, (url, expected) => expect(normalize_static_url(url)).toBe(expected))

  test(`loads routes and paginated Pagefind section results`, async () => {
    const route_actions = [`/`, `/plot`].map(make_route_action)
    const navigate = vi.fn()
    const search = vi.fn(async () => ({
      results: [`Histogram`, `Scatter plot`].map((title, idx) => ({
        id: `${idx}`,
        data: async () => ({
          url: `/plot/${title.toLowerCase().replaceAll(` `, `-`)}.html`,
          plain_excerpt: `${title} content`,
          meta: { title },
          sub_results:
            title === `Histogram`
              ? [
                  {
                    title: `Custom bin thresholds`,
                    url: `/plot/histogram.html#custom-bin-thresholds`,
                    plain_excerpt: `  Configure\n explicit   &lt;thresholds&gt;. `,
                  },
                ]
              : [],
        }),
      })),
    }))
    const load_options = create_site_search_loader({
      route_actions,
      navigate,
      load_pagefind: async () => ({ search }),
    })

    await expect(load_options({ search: ``, offset: 0, limit: 1 })).resolves.toEqual({
      options: [route_actions[0]],
      hasMore: true,
    })
    const first_page = await load_options({ search: `plot`, offset: 0, limit: 1 })
    const [first_action] = first_page.options
    expect(first_action).toMatchObject({
      id: `search:0:/plot/histogram#custom-bin-thresholds`,
      label: `Histogram › Custom bin thresholds`,
      description: `Configure explicit <thresholds>.`,
      url: `/plot/histogram#custom-bin-thresholds`,
    })
    first_action?.action(first_action.label)
    expect(navigate).toHaveBeenCalledWith(`/plot/histogram#custom-bin-thresholds`)

    const second_page = await load_options({ search: `plot`, offset: 1, limit: 1 })
    expect(second_page).toMatchObject({
      hasMore: false,
      options: [{ label: `Scatter plot`, url: `/plot/scatter-plot` }],
    })
    expect(search).toHaveBeenCalledTimes(2)
  })

  test(`falls back to matching routes when the production index is unavailable`, async () => {
    const route_actions = [`/plot/histogram`, `/structure`, `/trajectory`].map(
      make_route_action,
    )
    const load_options = create_site_search_loader({
      route_actions,
      navigate: vi.fn(),
      load_pagefind: async () => {
        throw new Error(`Pagefind index unavailable`)
      },
    })

    await expect(load_options({ search: `HISTOGRAM`, offset: 0, limit: 10 })).resolves.toEqual(
      {
        options: [route_actions[0]],
        hasMore: false,
      },
    )
  })
})
