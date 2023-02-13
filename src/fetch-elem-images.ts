import fs from 'node:fs'
import elements from './lib/element-data.ts'

// to run this script: deno run --allow-all src/fetch-elem-images.ts
// requires brew install deno

// make sure the directory exists
fs.mkdirSync(`./static/elements`, { recursive: true })

const fallback_urls: Record<string, string> = {
  '55 cesium': `https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Cesium.jpg/2560px-Cesium.jpg`,
  '105 dubnium': `https://cdn.dribbble.com/users/3013/screenshots/10679769/media/8ad2ce46f162ae93ba7ba464482f65c8.png`,
  '106 seaborgium': `https://periodiske-system.dk/img/images/lowRes/106.jpg`,
  '107 bohrium': `https://periodiske-system.dk/img/images/lowRes/107.jpg`,
  '108 hassium': `https://periodiske-system.dk/img/images/lowRes/108.jpg`,
  '109 meitnerium': `https://periodiske-system.dk/img/images/lowRes/109.jpg`,
  '110 darmstadtium': `https://periodiske-system.dk/img/images/lowRes/110.jpg`,
  '111 roentgenium': `https://periodiske-system.dk/img/images/lowRes/111.jpg`,
}

async function download_elem_image(name: string, number: number) {
  const url = `https://images-of-elements.com/s/${name}.jpg`
  let response = await fetch(url)

  if (!response.ok) {
    const fallback_url = fallback_urls[`${number} ${name}`]
    if (fallback_url) response = await fetch(fallback_url)
  }

  if (!response.ok) {
    return console.error(
      `Error downloading image for ${number} ${name}: ${response.statusText}`
    )
  }
  // check we got jpg or png mime type
  const content_type = response.headers.get(`content-type`)
  if (!content_type?.startsWith(`image/`)) {
    return console.error(
      `Error downloading image for ${number} ${name}: unexpected content type ${content_type}`
    )
  }

  const buffer = await response.arrayBuffer()
  fs.promises.writeFile(
    `./static/elements/${number}-${name}.jpg`,
    new Uint8Array(buffer)
  )
}

for (const { name, number } of elements) {
  await download_elem_image(name.toLowerCase(), number)
}
