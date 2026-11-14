import ElementPhoto from '#lib/element/ElementPhoto.svelte'
import element_data from '#lib/element/data.js'
import { mount, tick, unmount } from 'svelte'
import { expect, test } from 'vite-plus/test'
import { doc_query } from '../setup'

test(`uses the requested image URL and retries when it changes`, async () => {
  const props = $state({
    element: element_data[0],
    src: `/elements/1-hydrogen.avif`,
    loading: `lazy` as const,
  })
  const component = mount(ElementPhoto, { target: document.body, props })
  const image = doc_query<HTMLImageElement>(`img`)
  expect(image.getAttribute(`src`)).toBe(props.src)
  expect(image.getAttribute(`loading`)).toBe(`lazy`)
  image.dispatchEvent(new Event(`error`))
  await tick()
  expect(image.hidden).toBe(true)
  props.src = `/replacement.avif`
  await tick()
  expect(image.hidden).toBe(false)
  expect(image.getAttribute(`src`)).toBe(props.src)
  await unmount(component)
})

// null means "no photo exists": no request (whose 404 would log a console error), just the note
test(`a null src renders the no-image note without an img`, async () => {
  const element = element_data[117]
  const component = mount(ElementPhoto, {
    target: document.body,
    props: { element, src: null },
  })
  expect(document.querySelector(`img`)).toBeNull()
  expect(document.body.textContent?.replaceAll(/\s+/gu, ` `)).toContain(
    `No image for ${element.name}`,
  )
  await unmount(component)
})
