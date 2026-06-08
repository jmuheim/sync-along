import { describe, it, expect } from 'vitest';
import { buildBookmarklet, buildClientScript, buildBookmarkletSource } from '../lib/bookmarklet.js';

const WS = 'ws://192.168.1.1:3000';

describe('buildClientScript', () => {
  it('contains the provided wsURL', () => {
    const script = buildClientScript(WS);
    expect(script).toContain(WS);
  });

  it('guards against double-injection with __circleSyncClient flag', () => {
    const script = buildClientScript(WS);
    expect(script).toContain('__circleSyncClient');
  });

  it('reconnects on close with setTimeout', () => {
    const script = buildClientScript(WS);
    expect(script).toContain('setTimeout(connect');
  });

  it('handles both page and scroll message types', () => {
    const script = buildClientScript(WS);
    expect(script).toContain("m.type==='page'");
    expect(script).toContain("m.type==='scroll'");
  });

  it('uses document.open/write/close for page replacement', () => {
    const script = buildClientScript(WS);
    expect(script).toContain('document.open()');
    expect(script).toContain('document.write(m.html)');
    expect(script).toContain('document.close()');
  });

  it('connects with role=client query param', () => {
    const script = buildClientScript(WS);
    expect(script).toContain('role=client');
  });
});

describe('buildBookmarkletSource', () => {
  const clientScript = buildClientScript(WS);
  const source = buildBookmarkletSource(WS, clientScript);

  it('connects with role=master', () => {
    expect(source).toContain('role=master');
  });

  it('injects base href with original origin', () => {
    expect(source).toContain('<base href=');
  });

  it('injects viewport meta tag', () => {
    expect(source).toContain('width=device-width');
  });

  it('includes pick mode overlay creation', () => {
    expect(source).toContain('__circleSyncOverlay');
  });

  it('includes "Share whole page" button', () => {
    expect(source).toContain('Share whole page');
  });

  it('stores selector in sessionStorage keyed by domain', () => {
    expect(source).toContain('sessionStorage');
    expect(source).toContain('__circleSyncSel');
  });

  it('provides cleanup via window.__circleSyncCleanup', () => {
    expect(source).toContain('__circleSyncCleanup');
  });

  it('sends scroll events via setInterval', () => {
    expect(source).toContain("type:'scroll'");
    expect(source).toContain('setInterval');
  });

  it('shows saved element prompt when selector exists', () => {
    expect(source).toContain('Using saved element');
  });

  it('removes the floating button from shared HTML', () => {
    // The share button is removed via removeOverlay before sendPage
    expect(source).toContain('shareBtn.remove()');
  });

  it('strips old <base> tags before injecting new one', () => {
    expect(source).toContain("replace(/<base[^>]*>/gi,''");
  });

  it('injects the client script into shared HTML', () => {
    // clientScript is JSON.stringify'd into the source
    expect(source).toContain('__circleSyncClient');
  });
});

describe('buildBookmarklet', () => {
  it('returns a javascript: URL', () => {
    const bm = buildBookmarklet('192.168.1.1', 3000);
    expect(bm).toMatch(/^javascript:/);
  });

  it('URL-encodes special characters like braces', () => {
    const bm = buildBookmarklet('192.168.1.1', 3000);
    // { is encoded as %7B by encodeURIComponent
    expect(bm).toContain('%7B');
  });

  it('embeds the correct ws URL', () => {
    const bm = buildBookmarklet('10.0.0.5', 3000);
    const decoded = decodeURIComponent(bm.slice('javascript:'.length));
    expect(decoded).toContain('ws://10.0.0.5:3000');
  });

  it('minified output contains no // comments that would eat following code', () => {
    const bm = buildBookmarklet('192.168.1.1', 3000);
    const decoded = decodeURIComponent(bm.slice('javascript:'.length));
    // A // in the minified (single-line) output would comment out everything after it,
    // except inside strings. The only legitimate // should be inside ws:// URL strings.
    const withoutStrings = decoded.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
    expect(withoutStrings).not.toContain('//');
  });
});

describe('minified bookmarklet completeness', () => {
  it('still contains cleanup logic after minification', () => {
    const bm = buildBookmarklet('192.168.1.1', 3000);
    const decoded = decodeURIComponent(bm.slice('javascript:'.length));
    expect(decoded).toContain('__circleSyncCleanup');
    expect(decoded).toContain('showSavedPrompt');
    expect(decoded).toContain('startPickMode');
  });

  it('removes hint and shareBtn from DOM before sendPage in share-whole-page path', () => {
    const source = buildBookmarkletSource(WS, buildClientScript(WS));
    // The shareBtn click handler must remove UI elements before calling sendPage
    const shareBtnSection = source.slice(source.indexOf("shareBtn.addEventListener('click'"));
    const removeBefore = shareBtnSection.indexOf('shareBtn.remove()');
    const sendAfter = shareBtnSection.indexOf('sendPage(document.body)');
    expect(removeBefore).toBeGreaterThan(0);
    expect(removeBefore).toBeLessThan(sendAfter);
  });

  it('mousedown listener is named so it can be removed', () => {
    const source = buildBookmarkletSource(WS, buildClientScript(WS));
    expect(source).toContain('function onMouseDown');
    expect(source).toContain("removeEventListener('mousedown',onMouseDown");
  });
});
