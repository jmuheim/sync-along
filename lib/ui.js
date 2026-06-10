import QRCode from 'qrcode';
import { buildStubBookmarklet } from './bookmarklet.js';

export async function buildIndexHTML(ip, port) {
  const clientURL = `http://${ip}:${port}/client.html`;
  const qrDataURL = await QRCode.toDataURL(clientURL, { width: 200, margin: 1 });
  const bookmarklet = buildStubBookmarklet(ip, port);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sync Along</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #1a1a2e; color: #eee; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; gap: 2rem; }
    h1 { font-size: 2rem; color: #e94560; letter-spacing: 2px; }
    .card { background: #16213e; border-radius: 16px; padding: 2rem; max-width: 480px; width: 100%; }
    .card h2 { margin-bottom: 1rem; font-size: 1.1rem; color: #a8b2d8; text-transform: uppercase; letter-spacing: 1px; }
    .bookmarklet-wrap { background: #0f3460; border-radius: 8px; padding: 1rem; word-break: break-all; font-size: 0.8rem; }
    a.bookmarklet { color: #e94560; font-weight: bold; text-decoration: none; font-size: 1rem; display: inline-block; background: #e94560; color: white; padding: 0.5rem 1.2rem; border-radius: 8px; margin-bottom: 0.75rem; }
    a.bookmarklet:hover { background: #c73652; }
    .hint { color: #a8b2d8; font-size: 0.85rem; margin-top: 0.5rem; }
    .qr-wrap { display: flex; flex-direction: column; align-items: center; gap: 1rem; }
    .qr-wrap img { border-radius: 8px; background: white; padding: 8px; }
    .url { font-family: monospace; color: #64ffda; font-size: 1rem; }
  </style>
</head>
<body>
  <h1>Sync Along</h1>

  <div class="card">
    <h2>Master bookmarklet</h2>
    <a class="bookmarklet" href="${bookmarklet}">Sync Along</a>
    <p class="hint">Drag to your bookmarks bar once. Fetches the latest code from the server on every tap — no need to re-drag after updates.</p>
    <p class="hint" style="margin-top:0.4rem">Test fixture: <a href="/demo" style="color:#64ffda">/demo</a></p>
    <div class="bookmarklet-wrap">${escapeHTML(bookmarklet)}</div>
  </div>

  <div class="card">
    <h2>Clients — scan or open</h2>
    <div class="qr-wrap">
      <img src="${qrDataURL}" alt="QR code" width="200" height="200">
      <a class="url" href="${clientURL}">${clientURL}</a>
    </div>
  </div>
</body>
</html>`;
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
