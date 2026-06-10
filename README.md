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

