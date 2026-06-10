import { test, expect } from '@playwright/test';
import { createServer } from '../../server.js';
import { buildBookmarkletSource, buildClientScript, buildStubBookmarklet } from '../../lib/bookmarklet.js';

const PORT = 3001;
const BASE = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}`;

let server;

test.beforeAll(async () => {
  server = createServer();
  await new Promise((resolve) => server.httpServer.listen(PORT, resolve));
});

test.afterAll(async () => {
  // Close all open WebSocket connections so httpServer.close() can drain
  server.wss.clients.forEach((ws) => ws.terminate());
  await new Promise((resolve) => server.wss.close(resolve));
  await new Promise((resolve) => server.httpServer.close(resolve));
});

// ─── New endpoints ─────────────────────────────────────────────────────────────

test('/bookmarklet-code.js serves minified bookmarklet logic with no-store header', async ({ page }) => {
  const response = await page.request.get(`${BASE}/bookmarklet-code.js`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/javascript');
  expect(response.headers()['cache-control']).toBe('no-store');
  const body = await response.text();
  expect(body).toContain('role=master');
  expect(body.trim().split('\n').length).toBe(1);
});

test('/demo and /demo/echords serve the e-chords fixture', async ({ page }) => {
  await page.goto(`${BASE}/demo/echords`);
  await expect(page.locator('#cifra_c')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Wonderwall' })).toBeVisible();
  // bare /demo is an alias for /demo/echords
  await page.goto(`${BASE}/demo`);
  await expect(page.locator('#cifra_c')).toBeVisible();
});

test('/demo/ug serves the Ultimate Guitar fixture', async ({ page }) => {
  await page.goto(`${BASE}/demo/ug`);
  await expect(page.locator('.js-tab-content')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Wonderwall/i })).toBeVisible();
});

test('stub bookmarklet catch handler fires an alert when fetch is blocked', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE);

  // Abort the request to simulate what a CSP connect-src violation does (rejects the fetch)
  await page.route(`${BASE}/bookmarklet-code.js`, route => route.abort());

  const dialogPromise = page.waitForEvent('dialog');

  // Decode and evaluate the real stub so we test the actual generated code
  const stub = buildStubBookmarklet('localhost', PORT);
  const stubCode = decodeURIComponent(stub.slice('javascript:'.length));
  page.evaluate(stubCode).catch(() => {});

  const dialog = await dialogPromise;
  expect(dialog.message()).toContain('Content Security Policy');
  await dialog.dismiss();

  await ctx.close();
});

// ─── Index page ────────────────────────────────────────────────────────────────

test('index page shows bookmarklet link, QR image, and client URL', async ({ page }) => {
  await page.goto(BASE);
  const bookmarkletHref = await page.locator('a.bookmarklet').getAttribute('href');
  expect(bookmarkletHref).toMatch(/^javascript:/);
  expect(await page.locator('img[alt="QR code"]').isVisible()).toBe(true);
  // Server renders the LAN IP, not localhost — just verify the link ends with /client.html
  const clientHref = await page.locator('a.url').getAttribute('href');
  expect(clientHref).toMatch(/\/client\.html$/);
  expect(await page.locator('a.url').isVisible()).toBe(true);
});

// ─── Client page initial state ─────────────────────────────────────────────────

test('client page loads and shows disconnected status, then connected after WS opens', async ({ page }) => {
  await page.goto(`${BASE}/client.html`);
  // Give WS time to connect
  await expect(page.locator('#status.connected')).toBeVisible({ timeout: 5000 });
  expect(await page.locator('#status').innerText()).toContain('Connected');
});

// ─── Page sync ─────────────────────────────────────────────────────────────────

test('master sending a page message updates all connected clients', async ({ browser }) => {
  const client1 = await browser.newPage();
  const client2 = await browser.newPage();

  await client1.goto(`${BASE}/client.html`);
  await client2.goto(`${BASE}/client.html`);

  // Wait for both clients to connect
  await expect(client1.locator('#status.connected')).toBeVisible({ timeout: 5000 });
  await expect(client2.locator('#status.connected')).toBeVisible({ timeout: 5000 });

  // Inject a master WebSocket and send a page message
  const clientScript = buildClientScript(`${WS}`);
  const sentHTML = `<!DOCTYPE html><html><head></head><body><p id="synced-content">Hello from master</p><script>${clientScript}<\/script></body></html>`;

  await client1.evaluate(async ({ wsURL, html }) => {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsURL}?role=master`);
      ws.onopen = () => { ws.send(JSON.stringify({ type: 'page', html })); ws.close(); resolve(); };
      ws.onerror = reject;
    });
  }, { wsURL: WS, html: sentHTML });

  // Both clients should now show the synced content
  await expect(client1.locator('#synced-content')).toBeVisible({ timeout: 5000 });
  await expect(client2.locator('#synced-content')).toBeVisible({ timeout: 5000 });

  await client1.close();
  await client2.close();
});

// ─── Scroll sync ───────────────────────────────────────────────────────────────

test('master scroll message moves client scroll position', async ({ browser }) => {
  // Build a tall page with the client script already injected so it reconnects
  const clientScript = buildClientScript(WS);
  const tallPageHTML = `<!DOCTYPE html><html><head></head><body style="height:5000px"><p id="top">top</p><p id="bottom" style="position:absolute;top:4900px">bottom</p><script>${clientScript}<\/script></body></html>`;

  const masterPage = await browser.newPage();
  const clientPage = await browser.newPage();

  await clientPage.goto(`${BASE}/client.html`);
  await expect(clientPage.locator('#status.connected')).toBeVisible({ timeout: 5000 });

  // Master sends the tall page first, then a scroll to 98%
  await masterPage.evaluate(async ({ wsURL, html }) => {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsURL}?role=master`);
      ws.onopen = async () => {
        ws.send(JSON.stringify({ type: 'page', html }));
        await new Promise(r => setTimeout(r, 300));
        ws.send(JSON.stringify({ type: 'scroll', ratio: 0.98 }));
        ws.close();
        resolve();
      };
      ws.onerror = reject;
    });
  }, { wsURL: WS, html: tallPageHTML });

  // Client should have scrolled down
  await expect(async () => {
    const scrollY = await clientPage.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(1000);
  }).toPass({ timeout: 5000 });

  await masterPage.close();
  await clientPage.close();
});

// ─── Client reconnect after document.write + scroll resets on new page ─────────

test('client re-establishes WebSocket after document.write and scroll resets correctly on second page', async ({ browser }) => {
  const clientScript = buildClientScript(WS);
  const tallPage = (id) => `<!DOCTYPE html><html><head></head><body style="height:5000px"><p id="${id}">anchor</p><script>${clientScript}<\/script></body></html>`;

  const masterPage = await browser.newPage();
  const clientPage = await browser.newPage();

  await clientPage.goto(`${BASE}/client.html`);
  await expect(clientPage.locator('#status.connected')).toBeVisible({ timeout: 5000 });

  const sendMaster = (msgs) => masterPage.evaluate(async ({ wsURL, msgs }) => {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsURL}?role=master`);
      ws.onopen = async () => {
        for (const m of msgs) { ws.send(JSON.stringify(m)); await new Promise(r => setTimeout(r, 150)); }
        ws.close(); resolve();
      };
      ws.onerror = reject;
    });
  }, { wsURL: WS, msgs });

  // Page 1: push content and scroll master to 80%
  await sendMaster([
    { type: 'page', html: tallPage('page1') },
    { type: 'scroll', ratio: 0.8 },
  ]);
  await expect(clientPage.locator('#page1')).toBeVisible({ timeout: 5000 });
  await expect(async () => {
    expect(await clientPage.evaluate(() => window.scrollY)).toBeGreaterThan(3500);
  }).toPass({ timeout: 5000 });

  // Page 2: share a second page and scroll from the top.
  // lastRatio on the surviving WS is 0.8; without the fix the direction logic
  // would read the first scroll (0.3) as "going up" and skip it.
  await sendMaster([
    { type: 'page', html: tallPage('page2') },
    { type: 'scroll', ratio: 0.3 },
  ]);
  await expect(clientPage.locator('#page2')).toBeVisible({ timeout: 5000 });
  // Client must scroll to ~30% — not stuck at 80% or stranded at 0%
  await expect(async () => {
    const y = await clientPage.evaluate(() => window.scrollY);
    expect(y).toBeGreaterThan(1000);
    expect(y).toBeLessThan(2500);
  }).toPass({ timeout: 5000 });

  await masterPage.close();
  await clientPage.close();
});

// ─── Bookmarklet pick mode ──────────────────────────────────────────────────────

test('bookmarklet enters pick mode: dims page, shows hint and share button; picking an element shares it and shows master view', async ({ browser }) => {
  const songContext = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const songPage = await songContext.newPage();

  // Navigate to a real origin first so sessionStorage is available inside the bookmarklet
  await songPage.goto(BASE);
  // Put lyrics in the top-left corner so it's away from the centred hint overlay
  await songPage.setContent(`
    <html><body style="margin:0">
      <div id="lyrics" style="position:absolute;top:0;left:0;width:200px;height:50px"><p>Amazing grace</p></div>
      <div id="other" style="position:absolute;top:100px">other content</div>
    </body></html>
  `);

  const clientScript = buildClientScript(WS);
  const bookmarkletCode = buildBookmarkletSource(WS, clientScript);

  await songPage.evaluate(bookmarkletCode);

  // Pick mode active: overlay, hint, and share button all visible
  await expect(songPage.locator('#__circleSyncOverlay')).toBeAttached({ timeout: 5000 });
  await expect(songPage.getByText('Tap the lyrics container')).toBeVisible();
  await expect(songPage.getByText('Share whole page')).toBeVisible();

  const clientPage = await browser.newPage();
  await clientPage.goto(`${BASE}/client.html`);
  await expect(clientPage.locator('#status.connected')).toBeVisible({ timeout: 5000 });

  // Dispatch a click directly at the lyrics element's coordinates so elementFromPoint
  // returns it reliably (Playwright's .click() goes through the accessibility tree which
  // respects pointer-events:none on the overlay, but elementFromPoint inside the handler
  // may still return an overlay element if the hint covers the target)
  const box = await songPage.locator('#lyrics').boundingBox();
  await songPage.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // Overlay must be cleaned up after pick
  await expect(songPage.locator('#__circleSyncOverlay')).not.toBeAttached({ timeout: 3000 });

  // Master view iframe should appear — same HTML as sent to clients
  await expect(songPage.locator('iframe#__circleSyncView')).toBeVisible({ timeout: 5000 });

  // Client should have received the picked content
  await expect(clientPage.getByText('Amazing grace')).toBeVisible({ timeout: 5000 });

  await songContext.close();
  await clientPage.close();
});

// ─── Bookmarklet "Share whole page" button ─────────────────────────────────────

test('"Share whole page" sends full body to clients without entering pick', async ({ browser }) => {
  const songContext = await browser.newContext();
  const songPage = await songContext.newPage();
  await songPage.setContent(`<html><body><article id="full-article">Full content</article></body></html>`);

  const clientScript = buildClientScript(WS);
  const bookmarkletCode = buildBookmarkletSource(WS, clientScript);
  await songPage.evaluate(bookmarkletCode);

  await expect(songPage.locator('#__circleSyncOverlay')).toBeAttached({ timeout: 5000 });

  const clientPage = await browser.newPage();
  await clientPage.goto(`${BASE}/client.html`);
  await expect(clientPage.locator('#status.connected')).toBeVisible({ timeout: 5000 });

  await songPage.getByText('Share whole page').click();

  // Master should now see the same iframe view as clients
  await expect(songPage.locator('iframe#__circleSyncView')).toBeVisible({ timeout: 5000 });
  await expect(clientPage.getByText('Full content')).toBeVisible({ timeout: 5000 });
  // The share button must not appear in the sent HTML
  await expect(clientPage.getByText('Share whole page')).not.toBeVisible();

  await songContext.close();
  await clientPage.close();
});

// ─── Selector memory ───────────────────────────────────────────────────────────

test('selector memory: second bookmarklet tap on same domain shows saved-element prompt', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.setContent(`<html><body style="margin:0"><div id="lyrics" class="verse" style="position:absolute;top:0;left:0;width:200px;height:50px"><p>Amazing grace</p></div></body></html>`);

  const clientScript = buildClientScript(WS);
  const code = buildBookmarkletSource(WS, clientScript);

  // First activation — pick an element to store the selector
  await page.evaluate(code);
  await expect(page.locator('#__circleSyncOverlay')).toBeAttached({ timeout: 5000 });
  const box = await page.locator('#lyrics').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('iframe#__circleSyncView')).toBeVisible({ timeout: 5000 });

  // Clean up master state and run the bookmarklet again on the same page
  await page.evaluate(() => { if (window.__circleSyncCleanup) window.__circleSyncCleanup(); });
  await page.evaluate(code);

  // Should show the saved-element prompt instead of full pick mode
  await expect(page.getByText('Using saved element')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Use it')).toBeVisible();
  await expect(page.getByText('Change?')).toBeVisible();
  // Full pick mode overlay should NOT appear
  await expect(page.locator('#__circleSyncOverlay')).not.toBeAttached();

  await ctx.close();
});

// ─── Scroll direction logic ────────────────────────────────────────────────────

test('scroll direction logic: client follows master when behind/above, stays put when already ahead/above', async ({ browser }) => {
  const clientScript = buildClientScript(WS);
  const tallPageHTML = `<!DOCTYPE html><html><head></head><body style="height:5000px"><p id="anchor">top</p><script>${clientScript}<\/script></body></html>`;

  const masterPage = await browser.newPage();
  const clientPage = await browser.newPage();

  await clientPage.goto(`${BASE}/client.html`);
  await expect(clientPage.locator('#status.connected')).toBeVisible({ timeout: 5000 });

  // Each sendScroll opens a fresh master WS, sends one scroll message, then closes
  const sendScroll = (ratio) => masterPage.evaluate(
    async ({ wsURL, ratio }) => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${wsURL}?role=master`);
        ws.onopen = () => { ws.send(JSON.stringify({ type: 'scroll', ratio })); ws.close(); resolve(); };
        ws.onerror = reject;
      });
    },
    { wsURL: WS, ratio },
  );

  // Push the tall page (this replaces client.html; injected script reconnects with lastRatio = -1)
  await masterPage.evaluate(async ({ wsURL, html }) => {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsURL}?role=master`);
      ws.onopen = () => { ws.send(JSON.stringify({ type: 'page', html })); ws.close(); resolve(); };
      ws.onerror = reject;
    });
  }, { wsURL: WS, html: tallPageHTML });
  await expect(clientPage.locator('#anchor')).toBeVisible({ timeout: 5000 });

  // ── Scenario 1: client is behind master scrolling down → follows ──────────────
  // lastRatio=-1, send 0.8 → down=true, clientRatio=0 → 0.8 > 0 → scrolls
  await sendScroll(0.8);
  await expect(async () => {
    expect(await clientPage.evaluate(() => window.scrollY)).toBeGreaterThan(3500);
  }).toPass({ timeout: 5000 });

  // ── Scenario 2: client ahead of master scrolling down → stays put ─────────────
  // lastRatio=0.8, pull client back up to 10% via scroll message, then push ahead manually
  await sendScroll(0.1); // client moves up (going up from 0.8→0.1, clientRatio=0.8 > 0.1 → scrolls up)
  await expect(async () => {
    expect(await clientPage.evaluate(() => window.scrollY)).toBeLessThan(800);
  }).toPass({ timeout: 5000 });

  await clientPage.evaluate(() => window.scrollTo(0, 4000)); // manually push client to 80%
  await clientPage.waitForTimeout(150);

  // lastRatio=0.1, send 0.5 (going down) — client is at 0.8, ahead of master's 0.5 → no scroll
  await sendScroll(0.5);
  await clientPage.waitForTimeout(400); // give message time to arrive
  expect(await clientPage.evaluate(() => window.scrollY)).toBeGreaterThan(3500);

  // ── Scenario 3: master scrolls up, client is below → client follows up ────────
  // lastRatio=0.5, client at 80%, send 0.1 (going up) → !down && 0.1 < 0.8 → scrolls up
  await sendScroll(0.1);
  await expect(async () => {
    expect(await clientPage.evaluate(() => window.scrollY)).toBeLessThan(800);
  }).toPass({ timeout: 5000 });

  // ── Scenario 4: master scrolls up, client already above master → stays put ─────
  // Prime lastRatio to 0.8 (client also moves to 80%)
  await sendScroll(0.8);
  await expect(async () => {
    expect(await clientPage.evaluate(() => window.scrollY)).toBeGreaterThan(3500);
  }).toPass({ timeout: 5000 });

  await clientPage.evaluate(() => window.scrollTo(0, 300)); // manually put client at ~6%
  await clientPage.waitForTimeout(150);

  // lastRatio=0.8, send 0.4 (going up) — client is at ~6%, already above 0.4 → no scroll
  await sendScroll(0.4);
  await clientPage.waitForTimeout(400);
  expect(await clientPage.evaluate(() => window.scrollY)).toBeLessThan(800);

  await masterPage.close();
  await clientPage.close();
});

// ─── Selector memory buttons ───────────────────────────────────────────────────

test('selector memory "Use it" shares the saved element and shows master view', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const songPage = await ctx.newPage();
  await songPage.goto(BASE);
  await songPage.setContent(`<html><body style="margin:0"><div id="lyrics" style="position:absolute;top:0;left:0;width:200px;height:50px"><p>Amazing grace saved</p></div></body></html>`);

  const clientScript = buildClientScript(WS);
  const code = buildBookmarkletSource(WS, clientScript);

  // First tap: pick the element to save the selector
  await songPage.evaluate(code);
  await expect(songPage.locator('#__circleSyncOverlay')).toBeAttached({ timeout: 5000 });
  const box = await songPage.locator('#lyrics').boundingBox();
  await songPage.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(songPage.locator('iframe#__circleSyncView')).toBeVisible({ timeout: 5000 });

  // Set up client, then re-tap to get the saved-element prompt
  const clientPage = await browser.newPage();
  await clientPage.goto(`${BASE}/client.html`);
  await expect(clientPage.locator('#status.connected')).toBeVisible({ timeout: 5000 });

  await songPage.evaluate(() => { if (window.__circleSyncCleanup) window.__circleSyncCleanup(); });
  await songPage.evaluate(code);
  await expect(songPage.getByText('Use it')).toBeVisible({ timeout: 5000 });

  // Click "Use it" — should share the saved element and show master view
  await songPage.getByRole('button', { name: 'Use it' }).click();
  await expect(songPage.locator('iframe#__circleSyncView')).toBeVisible({ timeout: 5000 });
  await expect(clientPage.getByText('Amazing grace saved')).toBeVisible({ timeout: 5000 });

  await ctx.close();
  await clientPage.close();
});

test('selector memory "Change?" re-enters pick mode', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.setContent(`<html><body style="margin:0"><div id="lyrics" style="position:absolute;top:0;left:0;width:200px;height:50px"><p>Change test</p></div></body></html>`);

  const clientScript = buildClientScript(WS);
  const code = buildBookmarkletSource(WS, clientScript);

  // First tap: pick to save selector
  await page.evaluate(code);
  await expect(page.locator('#__circleSyncOverlay')).toBeAttached({ timeout: 5000 });
  const box = await page.locator('#lyrics').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('iframe#__circleSyncView')).toBeVisible({ timeout: 5000 });

  // Re-tap to get the saved-element prompt
  await page.evaluate(() => { if (window.__circleSyncCleanup) window.__circleSyncCleanup(); });
  await page.evaluate(code);
  await expect(page.getByText('Change?')).toBeVisible({ timeout: 5000 });

  // Click "Change?" — prompt disappears and full pick mode starts
  await page.getByText('Change?').click();
  await expect(page.getByText('Change?')).not.toBeVisible({ timeout: 3000 });
  await expect(page.locator('#__circleSyncOverlay')).toBeAttached({ timeout: 5000 });
  await expect(page.getByText('Tap the lyrics container')).toBeVisible();

  await ctx.close();
});

// ─── Master view close button ──────────────────────────────────────────────────

test('master view close button dismisses the overlay', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.setContent(`<html><body style="margin:0"><div id="lyrics" style="position:absolute;top:0;left:0;width:200px;height:50px"><p>Close test</p></div></body></html>`);

  const clientScript = buildClientScript(WS);
  const code = buildBookmarkletSource(WS, clientScript);

  await page.evaluate(code);
  await expect(page.locator('#__circleSyncOverlay')).toBeAttached({ timeout: 5000 });
  const box = await page.locator('#lyrics').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('iframe#__circleSyncView')).toBeVisible({ timeout: 5000 });

  // Close button must be visible alongside the master view
  await expect(page.locator('#__circleSyncCloseBtn')).toBeVisible();

  await page.locator('#__circleSyncCloseBtn').click();

  await expect(page.locator('iframe#__circleSyncView')).not.toBeAttached({ timeout: 3000 });
  await expect(page.locator('#__circleSyncCloseBtn')).not.toBeAttached();

  await ctx.close();
});

test('master view hides original page content and restores it on close', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.setContent(`<html><body style="margin:0"><div id="lyrics" style="position:absolute;top:0;left:0;width:200px;height:50px"><p>Visibility test</p></div></body></html>`);

  const clientScript = buildClientScript(WS);
  const code = buildBookmarkletSource(WS, clientScript);

  await page.evaluate(code);
  await expect(page.locator('#__circleSyncOverlay')).toBeAttached({ timeout: 5000 });
  const box = await page.locator('#lyrics').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('iframe#__circleSyncView')).toBeVisible({ timeout: 5000 });

  // Body must be hidden to prevent original page showing through elastic overscroll
  const bodyVisibility = await page.evaluate(() => document.body.style.visibility);
  expect(bodyVisibility).toBe('hidden');

  // iframe and close button must remain visible despite body being hidden
  await expect(page.locator('iframe#__circleSyncView')).toBeVisible();
  await expect(page.locator('#__circleSyncCloseBtn')).toBeVisible();

  // Closing must restore body visibility
  await page.locator('#__circleSyncCloseBtn').click();
  await expect(page.locator('iframe#__circleSyncView')).not.toBeAttached({ timeout: 3000 });
  const bodyVisibilityAfter = await page.evaluate(() => document.body.style.visibility);
  expect(bodyVisibilityAfter).toBe('');

  await ctx.close();
});

// ─── Bookmarklet re-tap cleanup ────────────────────────────────────────────────

test('re-tapping bookmarklet cleans up previous WS and pick mode', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.setContent(`<html><body><div id="lyrics">Lyrics</div></body></html>`);

  const clientScript = buildClientScript(WS);
  const code = buildBookmarkletSource(WS, clientScript);

  // First tap — wait for pick mode to start
  await page.evaluate(code);
  await expect(page.locator('#__circleSyncOverlay')).toBeAttached({ timeout: 5000 });

  // Second tap: cleanup runs synchronously, then pick mode restarts once ws.onopen fires
  await page.evaluate(code);
  // Wait for the new overlay to appear, then confirm there's exactly one (no stacking)
  await expect(page.locator('#__circleSyncOverlay')).toBeAttached({ timeout: 5000 });
  expect(await page.locator('#__circleSyncOverlay').count()).toBe(1);

  await ctx.close();
});
