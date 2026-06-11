Build me a local singing circle sync app. Here's the full architecture:

**Overview**
A local WiFi app where a master device controls what song/page all client devices see. Master browses normally, taps a bookmarklet to share the current page, and all connected clients instantly see the same page and follow the master's scroll position.

**Components to build**

1. **Node.js server** (`server.js`)
   - Serves the client web app as a static HTML page
   - WebSocket server handling two types of connected peers: one master, multiple clients
   - When it receives a `page` message from master, broadcasts the HTML to all clients
   - When it receives a `scroll` message from master, broadcasts scroll position to all clients

2. **Client web app** (`client.html`)
   - Served by the Node.js server
   - Connects to the WebSocket server on load
   - When it receives a `page` message, does `document.open(); document.write(html); document.close()` to replace the entire page content
   - When it receives a `scroll` message containing a `ratio` (0–1), scrolls proportionally: `window.scrollTo(0, ratio * (scrollHeight - innerHeight))`; only applies the scroll if it would move in the correct direction relative to the current position
   - When it receives a `clientInfo` message (with `name` and `colorIndex`), updates the debug overlay and persists the identity to `sessionStorage` so it survives `document.write()`
   - When it receives a `requestViewport` message, immediately sends a `viewport` message back
   - Sends `viewport` messages (`{ type, height, width, scrollY, pageHeight, pageWidth }`) on connect, resize, and scroll
   - Shows a persistent debug overlay (bottom-right badge) with assigned name/color and live viewport/scroll dims; the overlay re-appears after every `document.write()` by restoring identity from `sessionStorage`
   - Scrollbars are hidden on all client views (waiting screen and shared pages)
   - Suppresses iOS pinch-zoom (`touchmove` scale check) and gesture events
   - Must re-inject itself recursively: every page written must contain this same client script so it survives `document.write()` replacing the page

3. **Bookmarklet** (displayed in the server's UI so the master can save it)
   - A `javascript:` URL the master saves as a browser bookmark — works on any browser, any device, including mobile
   - When tapped on any page it does the following:
     - Enters **pick mode**: the page dims, and as the master hovers (desktop) or moves their finger (mobile), elements are highlighted with an outline
     - All touch/click events are intercepted (`preventDefault()`) during pick mode so the master doesn't accidentally trigger links
     - When the master clicks/taps an element, pick mode exits and that element is used as the content to share
     - A small floating **"Share whole page"** button is also shown during pick mode, in case the master wants to skip picking and send everything
     - Builds the HTML to send: the original page's full `<head>` verbatim (so all stylesheets, fonts, and CSS variables load correctly on clients), plus a `<body>` containing only the picked element
     - Injects `<base href="[original origin]">` into the head to fix relative URLs
     - Injects a `<meta name="viewport">`: if a specific element was picked, uses `width=[element pixel width],user-scalable=no` so clients render at the same scale; for whole-page shares uses `width=device-width,initial-scale=1,user-scalable=no`
     - Injects `<style>::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important}</style>` to hide scrollbars on clients
     - Injects the client sync script into the head (so clients auto-reconnect after `document.write()`)
     - Opens a WebSocket to the local server
     - Sends the result as a `{ type: 'page', html }` message
     - After sharing, opens a full-screen **master view iframe** showing the exact same HTML sent to clients (with `window.__circleSyncClient=true` set to prevent re-connecting), plus a close button (✕) to dismiss it
     - While the master view is open, the master's original page is hidden (`body.style.visibility='hidden'`) and scroll is locked; closing the iframe restores it
     - Installs a polling scroll listener (200 ms interval) that sends `{ type: 'scroll', ratio }` messages where `ratio = scrollTop / (scrollHeight - viewportHeight)`; reads scroll from the iframe when the master view is open
     - Shows a **master debug panel** (bottom-right) listing connected clients with their names, colors, and viewport sizes, plus master's own scroll and page dimensions; updates live as clients connect/disconnect/scroll
     - Shows **per-client viewport bars** (left edge) — one thin vertical track per client whose thumb height and position represent the client's viewport relative to the master content
     - Listens for `viewport`, `clientLeft`, and `clientJoined` messages from the server to keep the client list and bars up to date
     - If the master taps the bookmarklet again on a new page, the old WebSocket, scroll listener, master view, and any pick-mode UI are cleaned up and replaced
     - **Selector memory**: after the master picks an element, store the element's CSS selector (e.g. via a simple path of tag+class) keyed by domain in `sessionStorage`. On the next bookmarklet tap on the same domain, automatically pre-select that element and show a small "Using saved element — change?" prompt instead of entering full pick mode

**Technical details**
- Use `ws` npm package for WebSocket server
- Server runs on port 3000
- The server's index page should show: the bookmarklet link to drag to the bookmarks bar (works on desktop and mobile browsers), and a QR code plus plain URL for clients to open (e.g. `http://192.168.1.x:3000`)
- Auto-detect the server's local WiFi IP and display it
- No authentication, no database, no external services — entirely local
- **WebSocket message types** (master → server → clients): `page` (`{ type, html }`), `scroll` (`{ type, ratio }`)
- **WebSocket message types** (server → clients): `clientInfo` (`{ type, name, colorIndex }`), `requestViewport`
- **WebSocket message types** (clients → server → master): `viewport` (`{ type, height, width, scrollY, pageHeight, pageWidth, clientId, name, colorIndex }`)
- **WebSocket message types** (server → master): `clientJoined` (`{ type, clientId, name, colorIndex }`), `clientLeft` (`{ type, clientId }`)
- The server assigns each client a sequential name (e.g. "Client 1") and a color index for the debug overlay

**Pull Requests**
- When pushing to a pull request, update the PR description to reflect the current state of the changes

**Documentation**
- After any significant change, check `CLAUDE.md` and `README.md` for missing or outdated information and update them accordingly

**Testing**
- Always update existing tests when changing related code
- Add new tests for new or changed features when reasonable, but ask the user first

**Edge cases to handle**
- When `document.write()` replaces the page, the new page must immediately re-connect the WebSocket — the injected script handles this
- The bookmarklet must be re-tappable: navigating to a new song and tapping again should cleanly replace the previous session
- The `<base href>` must be injected so that relative asset URLs in the grabbed HTML still resolve correctly against the original site
- On mobile, touch events must be fully suppressed during pick mode to prevent accidental navigation; a clear visual indicator ("Tap the lyrics container") should be shown
- The floating "Share whole page" button must be positioned so it doesn't interfere with element picking, and must be removed from the HTML before sending to clients