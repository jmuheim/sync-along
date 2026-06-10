import QRCode from 'qrcode';
import { buildBookmarklet, buildBookmarkletRawCode } from './bookmarklet.js';

export async function buildIndexHTML(ip, port) {
  const clientURL = `http://${ip}:${port}/client.html`;
  const qrDataURL = await QRCode.toDataURL(clientURL, { width: 200, margin: 1 });
  const bookmarklet = buildBookmarklet(ip, port);

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
    a.dev-link { color: #64ffda; font-size: 0.85rem; display: inline-block; margin-top: 0.75rem; }
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
    <p class="hint">Drag to your bookmarks bar, or long-press on mobile to save as bookmark.</p>
    <div class="bookmarklet-wrap">${escapeHTML(bookmarklet)}</div>
    <a class="dev-link" href="/dev">→ Open dev page (test bookmarklet against demo pages)</a>
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

export function buildDevHTML(ip, port, demoPages) {
  const bookmarklet = buildBookmarklet(ip, port);
  const rawCode = buildBookmarkletRawCode(ip, port);

  const sidebarLinks = demoPages.map(name => {
    const label = name.replace(/\.html$/, '').replace(/-/g, ' ');
    return `<a href="#" class="demo-link" data-src="/demo-pages/${encodeURIComponent(name)}">${escapeHTML(label)}</a>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sync Along — Dev</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; font-family: system-ui, sans-serif; background: #1a1a2e; color: #eee; }
    #topbar {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.5rem 1rem; background: #0f3460;
      border-bottom: 2px solid #e94560; flex-shrink: 0;
    }
    #topbar h1 { font-size: 1rem; color: #e94560; letter-spacing: 1px; margin-right: auto; }
    #run-btn {
      background: #e94560; color: white; border: none;
      padding: 0.45rem 1rem; border-radius: 6px; cursor: pointer;
      font-size: 0.95rem; font-weight: bold;
    }
    #run-btn:hover { background: #c73652; }
    #run-btn:disabled { opacity: 0.5; cursor: default; }
    a.bookmarklet-link {
      background: #16213e; color: #64ffda; border: 1px solid #64ffda;
      padding: 0.4rem 0.8rem; border-radius: 6px; text-decoration: none;
      font-size: 0.85rem; white-space: nowrap;
    }
    a.bookmarklet-link:hover { background: #0f3460; }
    #layout { display: flex; height: calc(100vh - 44px); }
    #sidebar {
      width: 180px; flex-shrink: 0; background: #16213e;
      border-right: 1px solid #0f3460; overflow-y: auto;
      padding: 0.75rem 0;
    }
    #sidebar .section-label {
      font-size: 0.7rem; text-transform: uppercase; letter-spacing: 1px;
      color: #a8b2d8; padding: 0.25rem 0.75rem 0.5rem;
    }
    a.demo-link {
      display: block; padding: 0.5rem 0.75rem; color: #cdd6f4;
      text-decoration: none; font-size: 0.9rem; text-transform: capitalize;
    }
    a.demo-link:hover, a.demo-link.active { background: #0f3460; color: #64ffda; }
    #iframe-wrap { flex: 1; position: relative; }
    #demo-frame {
      width: 100%; height: 100%; border: none; background: white;
    }
    #placeholder {
      position: absolute; inset: 0; display: flex; align-items: center;
      justify-content: center; color: #a8b2d8; font-size: 1.1rem;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="topbar">
    <h1>Sync Along Dev</h1>
    <button id="run-btn" disabled>▶ Run bookmarklet</button>
    <a class="bookmarklet-link" href="${bookmarklet}">⬆ Drag to bookmarks bar</a>
  </div>
  <div id="layout">
    <nav id="sidebar">
      <div class="section-label">Demo pages</div>
      ${sidebarLinks}
    </nav>
    <div id="iframe-wrap">
      <div id="placeholder">← Pick a demo page to load it here</div>
      <iframe id="demo-frame" style="display:none"></iframe>
    </div>
  </div>
  <script>
    const BOOKMARKLET_CODE = ${JSON.stringify(rawCode)};
    const frame = document.getElementById('demo-frame');
    const runBtn = document.getElementById('run-btn');
    const placeholder = document.getElementById('placeholder');

    document.querySelectorAll('a.demo-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        document.querySelectorAll('a.demo-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        placeholder.style.display = 'none';
        frame.style.display = 'block';
        frame.src = link.dataset.src;
        runBtn.disabled = true;
        frame.onload = () => { runBtn.disabled = false; };
      });
    });

    runBtn.addEventListener('click', () => {
      if (frame.style.display === 'none') return;
      try {
        frame.contentWindow.eval(BOOKMARKLET_CODE);
      } catch(e) {
        alert('Could not run bookmarklet in frame: ' + e.message);
      }
    });
  </script>
</body>
</html>`;
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
