# Sync Along

A local WiFi app for singing circles where a leader's device controls what song/page everyone else sees. The leader browses normally, taps a bookmarklet to share the current page, and all participants instantly see the same page and follow along with the scroll position — so the whole circle can sing along together.

## Setup

```bash
npm install
npm run dev        # auto-restarts on file changes (development)
# or
npm start          # plain node, no watching (production)
```

The server starts on port 3000 and displays:
- A bookmarklet link to drag to the bookmarks bar (drag once — it fetches the latest code from the server on every tap, so no re-dragging after updates)
- A QR code and plain URL for clients to connect (e.g. `http://192.168.1.x:3000`)

## Usage

### Clients

Open the displayed URL (or scan the QR code) on each participant's device. The page will automatically follow the master's view.

### Master

1. Save the bookmarklet from the server's index page to your browser's bookmarks bar. You only need to do this once.
2. Navigate to any song/lyrics page (or use the dev fixtures at `http://localhost:3000/dev`).
3. Tap the bookmarklet to enter **pick mode**:
   - The page dims and elements are highlighted as you hover or move your finger.
   - Tap an element to share just that content, or tap **"Share whole page"** to send everything.
4. All clients immediately see the selected content and follow your scroll position.
5. Navigate to a new song and tap the bookmarklet again — the previous session is cleanly replaced.

**Selector memory:** After picking an element, the bookmarklet remembers your choice per domain. On the next tap on the same site, it auto-selects the saved element and shows a "Using saved element — change?" prompt, skipping full pick mode.

## Architecture

| File | Role |
|---|---|
| `server.js` | Node.js + WebSocket server; serves static pages and relays `page`/`scroll` messages from master to all clients |
| `client.html` | Browser app opened by participants; replaces its own content on `page` messages and scrolls on `scroll` messages |
| `lib/bookmarklet.js` | Builds the bookmarklet source, the tiny fetch+eval stub URL, and the `/bookmarklet-code.js` endpoint payload |
| `lib/ui.js` | Builds the index page and `/dev` page HTML |
| `lib/network.js` | Detects the local WiFi IP |
| `demos/` | Local HTML fixtures for development testing (shown in `/dev`) |

- No authentication, no database, no external services — entirely local.

## Bookmarklet size

The bookmarklet currently uses a **fetch+eval loader** pattern: the dragged bookmark is a tiny ~258-char stub that fetches the real code from the server on every tap. The full minified logic is ~12 KB, which as an inline `javascript:` URL would be ~15 KB.

Modern browsers handle inline bookmarklets of that size without issues (Chrome has a ~2 MB limit; Firefox and Safari have no meaningful hard limit). So size is **not a blocker** for inlining all code into the bookmark itself.

The loader pattern is kept for a different reason: during development you drag it once and always get the latest server-side code on every tap — no re-dragging needed after changes. If the bookmarklet were inlined, you'd need to re-save it after every code change.

If the code ever needs to shrink further (e.g. for a standalone distribution), the main levers are replacing the custom `minify()` function in `lib/bookmarklet.js` with a proper tool like `terser`, and more aggressive variable-name shortening.

## Todos

- **Client viewport bar accuracy:** The per-client bars on the master view are a good approximation but not 100% accurate — real device browsers (especially iOS Safari) may report `window.innerHeight` differently than Chromium's proportional scaling assumes. Good enough for now.
- **iOS fullscreen (Add to Home Screen):** Safari iOS doesn't support the Fullscreen API for web pages. Add `<meta name="apple-mobile-web-app-capable" content="yes">` and `<meta name="apple-mobile-web-app-status-bar-style" content="black-fullscreen">` to `client.html`, plus a dismissable "Add to Home Screen for fullscreen" hint banner so clients know to use that flow.
