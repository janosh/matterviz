export const routes = Object.keys(import.meta.glob(`../routes/**/+page.{svx,svelte,md}`))
  .filter((filename) => !filename.includes(`/(tmi)/`))
  .map(
    (filename) => {
      const parts = filename.split(`/`).filter((part) => !part.startsWith(`(`)) // remove hidden route segments
      return { route: `/${parts.slice(2, -1).join(`/`)}`, filename }
    },
  )

if (routes.length === 0) console.error(`No routes found: ${routes.length}`)

export const demo_routes = $state<string[]>(
  routes
    .filter(({ filename }) => filename.includes(`/(demos)/`))
    .map(({ route }) => route),
)
