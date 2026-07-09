import type { Attachment } from 'svelte/attachments'

// Attachment that moves its element into `target` (e.g. a host panel's toolbar),
// so components can offer optional external placement of their chrome (search/
// export/settings buttons etc.) without duplicating markup: pass nothing and the
// element renders inline where declared; pass a target and it teleports there.
// A comment anchor marks the original position so the element is restored when
// the target changes or unmounts, keeping Svelte's teardown sound.
export const portal =
  (target: HTMLElement | null | undefined): Attachment =>
  (element) => {
    if (!target) return undefined
    const anchor = document.createComment(`portal`)
    element.before(anchor)
    target.append(element)
    return () => anchor.replaceWith(element)
  }
