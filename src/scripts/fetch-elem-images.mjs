import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const element_data = JSON.parse(
  gunzipSync(readFileSync(new URL(`../lib/element/data.json.gz`, import.meta.url))).toString(
    `utf8`,
  ),
)
const fallback_urls = {
  '55-cesium': `https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Cesium.jpg/2560px-Cesium.jpg`,
  '105-dubnium': `https://cdn.dribbble.com/users/3013/screenshots/10679769/media/8ad2ce46f162ae93ba7ba464482f65c8.png`,
  '106-seaborgium': `https://periodiske-system.dk/img/images/lowRes/106.jpg`,
  '107-bohrium': `https://periodiske-system.dk/img/images/lowRes/107.jpg`,
  '108-hassium': `https://i0.wp.com/periodic-table.com/wp-content/uploads/2018/12/Hassium.png?w=225&ssl=1`,
  '109-meitnerium': `https://www.rsc-cdn.org/www.rsc.org/periodic-table/content/Images/Elements/Meitnerium-L.jpg`,
  '110-darmstadtium': `https://cdn1.byjus.com/wp-content/uploads/2018/08/Darmstadtium-2.jpg`,
  '111-roentgenium': `https://cdn1.byjus.com/wp-content/uploads/2018/08/Roentgenium-2.jpg`,
  '112-copernicum': `https://cdn1.byjus.com/wp-content/uploads/2018/08/Copernicum-2.jpg`,
}

const action = process.env.ACTION ?? ``
if (![`report`, `download`, `re-download`].includes(action)) {
  throw new Error(
    `Correct usage: ACTION=... node src/scripts/fetch-elem-images.mjs, got ${action}`,
  )
}

let sharp
if (action.endsWith(`download`)) {
  try {
    sharp = (await import(`sharp`)).default
  } catch (error) {
    throw new Error(`Image downloads require the optional "sharp" package`, { cause: error })
  }
}

mkdirSync(`./static/elements`, { recursive: true })

const download_elem_image = async (num_name) => {
  let url = `https://images-of-elements.com/s/${num_name.split(`-`)[1]}.jpg`
  let response = await fetch(url)
  if (!response.ok) {
    url = fallback_urls[num_name]
    if (url) response = await fetch(url)
  }
  if (!response.ok) {
    console.error(`Error downloading image for ${num_name}: ${response.statusText}`)
    return undefined
  }
  const content_type = response.headers.get(`content-type`)
  if (!content_type?.startsWith(`image/`)) {
    console.error(
      `Error downloading image for ${num_name}: unexpected content type ${content_type}`,
    )
    return undefined
  }
  await sharp(new Uint8Array(await response.arrayBuffer())).toFile(
    `./static/elements/${num_name}.avif`,
  )
  return url
}

if (action.endsWith(`download`)) console.warn(`Downloading images...`)
if (action === `report`) console.warn(`Missing images`)

const download_promises = []
for (const { name, number } of element_data) {
  const num_name = `${number}-${name.toLowerCase()}`
  const have_img = existsSync(`./static/elements/${num_name}.avif`)
  if (have_img && action !== `re-download`) continue
  if (action === `report`) console.warn(num_name)
  else download_promises.push(download_elem_image(num_name).then((url) => ({ num_name, url })))
}

if (download_promises.length > 0) {
  const settled = await Promise.allSettled(download_promises)
  const results = settled.flatMap((result) =>
    result.status === `fulfilled` ? [result.value] : [],
  )
  const img_src_out = `./src/lib/element-image-urls.json`
  const img_urls = existsSync(img_src_out) ? JSON.parse(readFileSync(img_src_out, `utf8`)) : {}
  for (const { num_name, url } of results) {
    if (url) img_urls[num_name] = url
  }
  writeFileSync(img_src_out, `${JSON.stringify(img_urls, null, 2)}\n`)
}
