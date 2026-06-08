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
   - When it receives a `scroll` message, does `window.scrollTo(0, y)`
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
     - Injects a `<meta name="viewport" content="width=device-width, initial-scale=1">` to fix layout on client mobile screens
     - Injects the client sync script into the body (so clients auto-reconnect after `document.write()`)
     - Opens a WebSocket to the local server
     - Sends the result as a `{ type: 'page', html }` message
     - Installs a scroll listener that continuously sends `{ type: 'scroll', y: window.scrollY }` messages
     - If the master taps the bookmarklet again on a new page, the old WebSocket, scroll listener, and any pick-mode UI are cleaned up and replaced
     - **Selector memory**: after the master picks an element, store the element's CSS selector (e.g. via a simple path of tag+class) keyed by domain in `sessionStorage`. On the next bookmarklet tap on the same domain, automatically pre-select that element and show a small "Using saved element — change?" prompt instead of entering full pick mode

**Technical details**
- Use `ws` npm package for WebSocket server
- Server runs on port 3000
- The server's index page should show: the bookmarklet link to drag to the bookmarks bar (works on desktop and mobile browsers), and a QR code plus plain URL for clients to open (e.g. `http://192.168.1.x:3000`)
- Auto-detect the server's local WiFi IP and display it
- No authentication, no database, no external services — entirely local

**Edge cases to handle**
- When `document.write()` replaces the page, the new page must immediately re-connect the WebSocket — the injected script handles this
- The bookmarklet must be re-tappable: navigating to a new song and tapping again should cleanly replace the previous session
- The `<base href>` must be injected so that relative asset URLs in the grabbed HTML still resolve correctly against the original site
- On mobile, touch events must be fully suppressed during pick mode to prevent accidental navigation; a clear visual indicator ("Tap the lyrics container") should be shown
- The floating "Share whole page" button must be positioned so it doesn't interfere with element picking, and must be removed from the HTML before sending to clients