import { describe, it, expect } from 'vitest';
import { buildIndexHTML, buildDevHTML } from '../lib/ui.js';

describe('buildIndexHTML', () => {
  it('includes the client URL', async () => {
    const html = await buildIndexHTML('192.168.1.1', 3000);
    expect(html).toContain('http://192.168.1.1:3000/client.html');
  });

  it('contains a QR code data URL', async () => {
    const html = await buildIndexHTML('192.168.1.1', 3000);
    expect(html).toContain('data:image/png;base64,');
  });

  it('contains the bookmarklet link', async () => {
    const html = await buildIndexHTML('192.168.1.1', 3000);
    expect(html).toContain('javascript:');
  });

  it('contains the Sync Along bookmarklet anchor', async () => {
    const html = await buildIndexHTML('192.168.1.1', 3000);
    expect(html).toContain('class="bookmarklet"');
  });

  it('escapes HTML in bookmarklet display', async () => {
    const html = await buildIndexHTML('192.168.1.1', 3000);
    // The raw display of the bookmarklet should not have unescaped < or >
    const displaySection = html.match(/bookmarklet-wrap[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(displaySection).not.toContain('<script');
  });
});

describe('buildDevHTML', () => {
  it('returns an HTML page with the dev title', () => {
    const html = buildDevHTML('192.168.1.1', 3000, []);
    expect(html).toContain('Sync Along Dev');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('includes a link for each demo page', () => {
    const html = buildDevHTML('192.168.1.1', 3000, ['song-a.html', 'song-b.html']);
    expect(html).toContain('/demos/song-a.html');
    expect(html).toContain('/demos/song-b.html');
  });

  it('renders demo names as human-readable labels (hyphens → spaces, capitalisation preserved)', () => {
    const html = buildDevHTML('192.168.1.1', 3000, ['my-song.html']);
    expect(html).toContain('my song');
  });

  it('escapes HTML special characters in demo names', () => {
    const html = buildDevHTML('192.168.1.1', 3000, ['<evil>.html']);
    expect(html).not.toContain('<<evil>');
    expect(html).toContain('&lt;evil&gt;');
  });

  it('includes the bookmarklet stub so it can be triggered in the frame', () => {
    const html = buildDevHTML('192.168.1.1', 3000, []);
    expect(html).toContain('STUB_CODE');
    expect(html).toContain('contentWindow.eval');
  });

  it('uses flex layout so the sidebar and demo frame fill the full viewport', () => {
    const html = buildDevHTML('192.168.1.1', 3000, []);
    expect(html).toContain('flex: 1');
    expect(html).not.toContain('calc(100vh -');
  });
});
