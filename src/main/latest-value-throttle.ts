/**
 * Deliver the first value immediately, then at most one value per interval: the
 * latest one seen. Intermediate snapshots are dropped, never reordered, so a
 * listener that renders full state stays correct while doing a fraction of the work.
 */
export function throttleLatest<T>(intervalMs: number, deliver: (value: T) => void): ((value: T) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: { value: T } | undefined
  let lastDeliveredAt = Number.NEGATIVE_INFINITY

  const flush = (): void => {
    timer = undefined
    if (!pending) return
    const { value } = pending
    pending = undefined
    lastDeliveredAt = Date.now()
    deliver(value)
  }

  const push = (value: T): void => {
    pending = { value }
    if (timer) return
    const wait = lastDeliveredAt + intervalMs - Date.now()
    if (wait <= 0) flush()
    else timer = setTimeout(flush, wait)
  }

  return Object.assign(push, {
    cancel(): void {
      if (timer) clearTimeout(timer)
      timer = undefined
      pending = undefined
    },
  })
}
