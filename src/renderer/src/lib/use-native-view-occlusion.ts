import { useLayoutEffect, useState } from 'react'

const OVERLAY_SELECTOR = [
  'popover-content', 'select-content', 'dropdown-menu-content',
  'dropdown-menu-sub-content', 'dialog-content', 'alert-dialog-content',
].map((slot) => `[data-slot="${slot}"]`).join(',')

/** Native child views composite above DOM portals regardless of CSS z-index. */
export function useNativeViewOcclusion(): boolean {
  const [occluded, setOccluded] = useState(false)
  useLayoutEffect(() => {
    const update = () => setOccluded(document.querySelector(OVERLAY_SELECTOR) !== null)
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true })
    update()
    return () => observer.disconnect()
  }, [])
  return occluded
}
