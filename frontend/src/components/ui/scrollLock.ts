/**
 * Page scroll lock, counted.
 *
 * Two things in the product hold it — the modal and the navigation drawer — and the
 * counter is why they can hold it at the same time. Each doing its own
 * `body.style.overflow = 'hidden'` and clearing it on close means whichever closes
 * first releases the lock for both, so the page scrolls underneath whatever is still
 * open. Nested cases are real: a confirmation dialog can open over a form reached from
 * the drawer.
 *
 * The scrollbar's width is added as padding while locked, so the page does not jump
 * sideways at the moment the scrollbar disappears — a 15px shift of every column on a
 * desktop, which reads as the layout breaking.
 */

let holders = 0
let restorePadding = ''

export function lockScroll(): void {
  if (holders === 0) {
    const gap = window.innerWidth - document.documentElement.clientWidth
    restorePadding = document.body.style.paddingRight
    document.body.style.overflow = 'hidden'
    if (gap > 0) document.body.style.paddingRight = `${gap}px`
  }
  holders += 1
}

export function unlockScroll(): void {
  holders = Math.max(0, holders - 1)
  if (holders === 0) {
    document.body.style.overflow = ''
    document.body.style.paddingRight = restorePadding
    restorePadding = ''
  }
}
