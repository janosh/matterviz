import { element_data } from '$lib/element'
import fs from 'node:fs'
import process from 'node:process'
import sharp from 'npm:sharp'

// make sure the directory exists
fs.mkdirSync(`./static/elements`, { recursive: true })

const fallback_urls: Record<string, string> = {
  '55-cesium':
    `https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Cesium.jpg/2560px-Cesium.jpg`,
  '105-dubnium':
    `https://cdn.dribbble.com/users/3013/screenshots/10679769/media/8ad2ce46f162ae93ba7ba464482f65c8.png`,
  '106-seaborgium': `https://periodiske-system.dk/img/images/lowRes/106.jpg`,
  '107-bohrium': `https://periodiske-system.dk/img/images/lowRes/107.jpg`,
  '108-hassium':
    `https://i0.wp.com/periodic-table.com/wp-content/uploads/2018/12/Hassium.png?w=225&ssl=1`,
  '109-meitnerium':
    `https://www.rsc-cdn.org/www.rsc.org/periodic-table/content/Images/Elements/Meitnerium-L.jpg`,
  // '109-meitnerium': `https://cdn1.byjus.com/wp-content/uploads/2018/08/Meitnerium-2.jpg`, // lower res but but looks more like raw crystal
  '110-darmstadtium':
    `https://cdn1.byjus.com/wp-content/uploads/2018/08/Darmstadtium-2.jpg`,
  '111-roentgenium':
    `https://cdn1.byjus.com/wp-content/uploads/2018/08/Roentgenium-2.jpg`,
  '112-copernicum': `https://cdn1.byjus.com/wp-content/uploads/2018/08/Copernicum-2.jpg`,
}

async function download_elem_image(num_name: string) {
  // default URL, this is where most of the element images come from
  let url = `https://images-of-elements.com/s/${num_name.split(`-`)[1]}.jpg`
  let response = await fetch(url)

  if (!response.ok) {
    url = fallback_urls[num_name]
    if (url) response = await fetch(url)
  }

  if (!response.ok) {
    console.error(
      `Error downloading image for ${num_name}: ${response.statusText}`,
    )
    return undefined
  }
  // check we got jpg or png mime type
  const content_type = response.headers.get(`content-type`)
  if (!content_type?.startsWith(`image/`)) {
    console.error(
      `Error downloading image for ${num_name}: unexpected content type ${content_type}`,
    )
    return undefined
  }

  const buffer = new Uint8Array(await response.arrayBuffer())
  // fs.writeFileSync(`./static/elements/${num_name}.jpg`, buffer)
  await sharp(buffer).toFile(`./static/elements/${num_name}.avif`)

  return url
}

const action = process.env.ACTION ?? ``
if (![`report`, `download`, `re-download`].includes(action)) {
  throw `Correct usage: ACTION=... deno -A fetch-elem-images.ts, got ${action}\n`
}
if (action.endsWith(`download`)) console.log(`Downloading images...`)
if (action === `report`) console.log(`Missing images`)

const download_promises: Promise<{ num_name: string; url: string | undefined }>[] = []

for (const { name, number } of element_data) {
  const num_name = `${number}-${name.toLowerCase()}`
  const have_img = fs.existsSync(`./static/elements/${num_name}.avif`)

  if (!have_img || action === `re-download`) {
    if (action === `report`) {
      console.log(num_name)
    } else if (action.endsWith(`download`)) {
      download_promises.push(
        download_elem_image(num_name).then((url) => ({ num_name, url })),
      )
    }
  }
}

// Process all downloads in parallel
if (download_promises.length > 0) {
  const settled = await Promise.allSettled(download_promises)
  const results = settled.flatMap((r) => (r.status === `fulfilled` ? [r.value] : []))

  // Update image source file with all results
  const img_src_out = `./src/lib/element-image-urls.json`
  const img_urls = fs.existsSync(img_src_out)
    ? JSON.parse(fs.readFileSync(img_src_out, `utf8`))
    : {}

  for (const { num_name, url } of results) {
    if (url) img_urls[num_name] = url
  }

  fs.writeFileSync(img_src_out, JSON.stringify(img_urls, null, 2) + `\n`)
}
