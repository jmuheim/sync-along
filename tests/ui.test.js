import { describe, it, expect } from 'vitest';
import { buildIndexHTML } from '../lib/ui.js';

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
