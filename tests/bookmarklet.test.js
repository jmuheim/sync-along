import vm from 'vm';
import { describe, it, expect } from 'vitest';
import { buildClientScript, buildBookmarkletSource, buildStubBookmarklet, buildBookmarkletCode } from '../lib/bookmarklet.js';

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

  it('re-sends viewport height on window resize via debounced listener', () => {
    const script = buildClientScript(WS);
    expect(script).toContain("addEventListener('resize'");
    expect(script).toContain('clearTimeout(resizeTimer)');
    expect(script).toContain('setTimeout(sendViewport');
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

  it('sends window.innerHeight as viewport height on connect', () => {
    const script = buildClientScript(WS);
    expect(script).toContain('window.innerHeight');
    expect(script).toContain("type:'viewport'");
  });

  it('re-sends viewport on requestViewport message', () => {
    const script = buildClientScript(WS);
    expect(script).toContain("m.type==='requestViewport'");
    expect(script).toContain('sendViewport');
  });

  it('ws is declared at outer scope so resize listener always uses current connection', () => {
    const script = buildClientScript(WS);
    // ws must be declared before connect() so the resize listener (also at outer scope) can
    // reference it without closing over a stale per-call local variable
    const wsDecl = script.indexOf('var ws=null');
    const connectDecl = script.indexOf('function connect()');
    expect(wsDecl).toBeGreaterThan(-1);
    expect(wsDecl).toBeLessThan(connectDecl);
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

describe('minified bookmarklet completeness', () => {
  it('minified output is syntactically valid JavaScript', () => {
    const code = buildBookmarkletCode('192.168.1.1', 3000);
    expect(() => new vm.Script(code)).not.toThrow();
  });

  it('still contains cleanup logic after minification', () => {
    const code = buildBookmarkletCode('192.168.1.1', 3000);
    expect(code).toContain('__circleSyncCleanup');
    expect(code).toContain('showSavedPrompt');
    expect(code).toContain('startPickMode');
  });

  it('minified output contains no // comments that would eat following code', () => {
    const code = buildBookmarkletCode('192.168.1.1', 3000);
    // A // in the minified (single-line) output would comment out everything after it,
    // except inside strings. The only legitimate // should be inside ws:// URL strings.
    const withoutStrings = code.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
    expect(withoutStrings).not.toContain('//');
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

  it('shareBtn and onPick both use if/else for WS readyState so no open listener is orphaned', () => {
    const source = buildBookmarkletSource(WS, buildClientScript(WS));
    // Both sendPage call sites must check readyState first and only attach the open
    // listener in the else branch — never unconditionally before the readyState check.
    const ifElseMatches = source.match(
      /if\(ws\.readyState===ws\.OPEN\)\{var h=sendPage\(/g
    ) || [];
    expect(ifElseMatches.length).toBe(2);
    // Confirm neither call site adds the listener before the readyState check
    expect(source).not.toMatch(/ws\.addEventListener\('open'[^)]+\);\s*if\(ws\.readyState/);
  });
});

describe('buildStubBookmarklet', () => {
  it('returns a javascript: URL', () => {
    const stub = buildStubBookmarklet('192.168.1.1', 3000);
    expect(stub).toMatch(/^javascript:/);
  });

  it('decoded stub fetches /bookmarklet-code.js from the server', () => {
    const stub = buildStubBookmarklet('10.0.0.5', 3000);
    const decoded = decodeURIComponent(stub.slice('javascript:'.length));
    expect(decoded).toContain('fetch(');
    expect(decoded).toContain('http://10.0.0.5:3000/bookmarklet-code.js');
  });

  it('includes a .catch() handler', () => {
    const stub = buildStubBookmarklet('192.168.1.1', 3000);
    const decoded = decodeURIComponent(stub.slice('javascript:'.length));
    expect(decoded).toContain('.catch(');
  });

  it('catch handler alerts about Content Security Policy', () => {
    const stub = buildStubBookmarklet('192.168.1.1', 3000);
    const decoded = decodeURIComponent(stub.slice('javascript:'.length));
    expect(decoded).toContain('Content Security Policy');
  });
});

describe('buildBookmarkletCode', () => {
  it('returns the full bookmarklet logic', () => {
    const code = buildBookmarkletCode('192.168.1.1', 3000);
    expect(code).toContain('role=master');
    expect(code).toContain('__circleSyncCleanup');
  });

  it('is minified to a single line', () => {
    const code = buildBookmarkletCode('192.168.1.1', 3000);
    expect(code.trim().split('\n').length).toBe(1);
  });

  it('embeds the correct ws URL', () => {
    const code = buildBookmarkletCode('10.0.0.5', 3000);
    expect(code).toContain('ws://10.0.0.5:3000');
  });
});

describe('proportional scroll — buildClientScript', () => {
  it('computes scrollable range as scrollHeight minus innerHeight', () => {
    const script = buildClientScript(WS);
    expect(script).toContain('scrollHeight-window.innerHeight');
  });

  it('divides scrollY by the scrollable range, not total scrollHeight', () => {
    const script = buildClientScript(WS);
    expect(script).toContain('window.scrollY/scrollable');
  });

  it('scrolls to ratio * scrollable, not ratio * scrollHeight', () => {
    const script = buildClientScript(WS);
    expect(script).toContain('m.ratio*scrollable');
  });
});

describe('client viewport bars — buildBookmarkletSource', () => {
  const source = buildBookmarkletSource(WS, buildClientScript(WS));

  it('handles viewport message from clients and stores height by clientId', () => {
    expect(source).toContain("m.type==='viewport'");
    expect(source).toContain('clients[m.clientId]');
  });

  it('handles clientLeft message and removes client from map', () => {
    expect(source).toContain("m.type==='clientLeft'");
    expect(source).toContain('delete clients[m.clientId]');
  });

  it('creates bars container with id __circleSyncBars for test selection', () => {
    expect(source).toContain("clientBarsEl.id='__circleSyncBars'");
  });

  it('suppresses client script in master iframe via __circleSyncClient guard', () => {
    expect(source).toContain('window.__circleSyncClient=true');
  });

  it('computes vMasterContent using zoom-aware iframe dimensions', () => {
    expect(source).toContain('iframeVpH*lastElWidth/iframeVpW');
  });

  it('uses vMasterContent as reference height when computing bar fraction', () => {
    expect(source).toContain('c.height/vMasterContent');
  });
});

describe('proportional scroll — buildBookmarkletSource sendScroll', () => {
  it('uses viewportHeight in the denominator when computing the sent ratio', () => {
    const source = buildBookmarkletSource(WS, buildClientScript(WS));
    expect(source).toContain('scrollHeight-viewportHeight');
  });

  it('reads viewportHeight from the master iframe when it is open', () => {
    const source = buildBookmarkletSource(WS, buildClientScript(WS));
    expect(source).toContain('masterOverlay.contentWindow.innerHeight');
  });
});
