/*
 * Runs first, in the <head> of every page (Milestone 30, Phase 6). Two jobs.
 *
 * 1. The theme, before the first paint. The homepage arrives already drawn
 *    (vite.prerender.ts), so it paints before React has loaded — and before
 *    src/context/ThemeContext.tsx, which applies `.theme-dark`, has run. Without this a
 *    reader whose device or choice is dark would see the light page and then a flash. It
 *    repeats ThemeContext's precedence exactly — a stored choice, otherwise the device,
 *    otherwise light — and ThemeContext stays the authority once React runs. Change one,
 *    change the other: the key is ThemeContext's STORAGE_KEY, 'amit-theme'.
 *
 * 2. On the drawn homepage only, the app — after the first paint. There vite.prerender.ts
 *    takes the app's <script type="module"> and its preloads out of the HTML and lists them
 *    on this tag (data-entry, data-preload): 120 KB of script downloading beside the
 *    stylesheets is what the first paint waited behind on a slow phone, and the drawn page
 *    needs none of it to be read. They are added once a frame has been drawn; the timer
 *    beside it adds them regardless, because a tab that is not being drawn never runs a
 *    frame (CLAUDE.md) and the app must load either way. Every other page carries no
 *    data-entry: its module script is in its HTML as usual.
 *
 * A file rather than an inline script, so that the Content Security Policy can go on
 * allowing scripts from this site only (vercel.json).
 */
;(function () {
  var root = document.documentElement

  var stored = null
  try {
    stored = window.localStorage.getItem('amit-theme')
  } catch {
    // Storage blocked: fall through to the device, as ThemeContext does.
  }
  var dark = stored === 'dark'
  if (stored !== 'dark' && stored !== 'light') {
    try {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    } catch {
      // No matchMedia: light, as ThemeContext does.
    }
  }
  if (dark) {
    root.classList.add('theme-dark')
    root.style.colorScheme = 'dark'
  }

  var self = document.currentScript
  var entry = self && self.getAttribute('data-entry')
  if (!entry) return
  var preloads = (self.getAttribute('data-preload') || '').split(' ').filter(Boolean)

  var started = false
  function start() {
    if (started) return
    started = true
    for (var i = 0; i < preloads.length; i++) {
      var link = document.createElement('link')
      link.rel = 'modulepreload'
      link.crossOrigin = ''
      link.href = preloads[i]
      document.head.appendChild(link)
    }
    var script = document.createElement('script')
    script.type = 'module'
    script.crossOrigin = ''
    script.src = entry
    document.head.appendChild(script)
  }

  // A frame is drawn only once the stylesheets have arrived, so this runs after the first paint.
  window.requestAnimationFrame(function () {
    setTimeout(start, 0)
  })
  setTimeout(start, 1500)
})()
