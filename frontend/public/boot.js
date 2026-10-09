/*
 * Runs first, in the <head> of every page (Milestone 30, Phase 6). Four jobs — the third,
 * a festive edition and its intro (Phase 7), and the fourth, the homepage's picture of the day,
 * are described where they run.
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

  /*
   * 3. A festive edition (Phase 7 — the Diwali edition, 8 to 15 November 2026), also before
   *    the first paint. Its dates are src/lib/season.ts's, written into the
   *    <meta name="amit-season"> above this tag as "kind id startsAt endsAt introMs". While it
   *    is on, <html data-season="diwali">, and every festive touch is CSS keyed on that — so
   *    the drawn homepage needs no second version, and after the end date the site is simply
   *    itself again. ?season=diwali previews it for the tab's session (and replays the intro),
   *    ?season=off hides it, ?season=auto goes back to the dates.
   */
  var season = (function () {
    var meta = document.querySelector('meta[name="amit-season"]')
    var parts = meta ? (meta.getAttribute('content') || '').split(' ') : []
    return parts.length === 5 ? parts : null
  })()
  if (season) {
    var kind = season[0]
    var asked = null
    var mode = null
    try {
      asked = new URLSearchParams(window.location.search).get('season')
      if (asked === kind || asked === 'off') window.sessionStorage.setItem('amit-season', asked)
      if (asked === 'auto') window.sessionStorage.removeItem('amit-season')
      mode = window.sessionStorage.getItem('amit-season')
    } catch {
      // Storage blocked: the dates alone decide, as they do for everybody else.
    }
    var nowMs = Date.now()
    var dated = nowMs >= Date.parse(season[2]) && nowMs < Date.parse(season[3])
    if (mode === kind || (mode !== 'off' && dated)) {
      root.setAttribute('data-season', kind)
      playIntro(season[1], Number(season[4]) || 2100, asked === kind)
    }
  }

  /*
   * The intro — "the Diwali launch moment" — on the homepage, the first time each browser sees
   * the edition. Its markup is drawn outside the app's root (vite.prerender.ts), so the app
   * taking over cannot restart it. Never for a reader who asked for less motion, never in a tab
   * nobody is looking at, never when the address asks for something (#login, ?next=). Any key,
   * tap, click or scroll ends it — and the timer ends it regardless, because an animation that
   * never runs must not leave the page covered (CLAUDE.md).
   */
  function playIntro(id, ms, replay) {
    var where = window.location
    if (where.pathname !== '/' || where.hash || /[?&]next=/.test(where.search)) return
    if (document.visibilityState && document.visibilityState !== 'visible') return
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    } catch {
      // No matchMedia: treated as no preference.
    }
    var seen = null
    try {
      seen = window.localStorage.getItem('amit-intro')
      if (seen !== id) window.localStorage.setItem('amit-intro', id)
    } catch {
      // Storage blocked: it plays on this visit and cannot be remembered.
    }
    if (seen === id && !replay) return

    root.setAttribute('data-intro', 'play')
    var events = ['keydown', 'pointerdown', 'touchstart', 'wheel']
    function end() {
      root.removeAttribute('data-intro')
      for (var i = 0; i < events.length; i++) window.removeEventListener(events[i], end, true)
    }
    for (var i = 0; i < events.length; i++) window.addEventListener(events[i], end, { capture: true, passive: true })
    setTimeout(end, ms)
  }

  /*
   * 4. The homepage's picture of the day (owner, 2026-10-09): which of the drawn pictures in the
   *    hero's square is today's, by the India date, so the page drawn at build time shows today's
   *    from its first paint and nothing swaps when the app takes over. How many there are is
   *    written into <meta name="amit-art"> by vite.seo.ts; CSS shows the one this names.
   */
  var art = document.querySelector('meta[name="amit-art"]')
  var pictures = art ? Number(art.getAttribute('content')) : 0
  if (pictures > 0) {
    var indiaDay = Math.floor((Date.now() + 5.5 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000))
    root.setAttribute('data-picture', String(indiaDay % pictures))
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
