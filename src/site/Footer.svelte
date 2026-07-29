<script lang="ts">
  import pkg from '$root/package.json'
  import { Footer } from 'svelte-widgets'
</script>

<Footer
  links={[
    { href: `${pkg.repository}/blob/main/license`, label: `License`, icon: `License` },
    { href: `/acknowledgements`, label: `Acknowledgements`, icon: `HandsClapping` },
    {
      href: `${pkg.repository}/blob/main/contributing.md`,
      label: `Contributing`,
      icon: `RepoFork`,
    },
  ]}
>
  <small>
    &copy; <a href="https://github.com/janosh">Janosh Riebesell</a>
    2022
  </small>
</Footer>
