import { describe, expect, it } from 'vitest';
import { parseVideoUrl } from '../src/inputs/urls.js';
import { flattenRow, parseRows } from '../src/inputs/sheet.js';

/**
 * The second module with tests, and the reason is the same as analyze.ts:
 * this is where untrusted input enters the system. Ops paste links from
 * phones, browsers, and Discord, and the challenge brief says explicitly to
 * assume "incomplete, unexpected, or invalid input".
 *
 * parseRows is included because rejecting a bad row is only half the job --
 * the other half is telling ops which row to fix.
 */

describe('parseVideoUrl: YouTube', () => {
  const cases: Array<[string, string]> = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    // Share links carry tracking params; timestamps and playlists are common.
    ['https://youtu.be/dQw4w9WgXcQ?si=AbCdEf123456', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLxxx', 'dQw4w9WgXcQ'],
    // A human typing into a spreadsheet cell does not always include a scheme.
    ['youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['  https://youtu.be/dQw4w9WgXcQ  ', 'dQw4w9WgXcQ'],
  ];

  it.each(cases)('extracts the id from %s', (url, expected) => {
    const result = parseVideoUrl(url);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.platform).toBe('youtube');
      expect(result.videoId).toBe(expected);
    }
  });
});

describe('parseVideoUrl: TikTok', () => {
  it('extracts the id from a canonical video link', () => {
    const result = parseVideoUrl('https://www.tiktok.com/@some.creator/video/7239485712398471234');
    expect(result).toEqual({ ok: true, platform: 'tiktok', videoId: '7239485712398471234' });
  });

  it('accepts a share link using the share code as a provisional id', () => {
    const result = parseVideoUrl('https://vm.tiktok.com/ZMhJqQ8Kd/');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.platform).toBe('tiktok');
  });
});

describe('parseVideoUrl: rejections', () => {
  it('rejects an empty cell', () => {
    expect(parseVideoUrl('   ').ok).toBe(false);
  });

  it('rejects a non-URL', () => {
    expect(parseVideoUrl('ask marco for the link').ok).toBe(false);
  });

  it('rejects a supported-looking link with no video id', () => {
    expect(parseVideoUrl('https://www.youtube.com/@somechannel').ok).toBe(false);
  });

  it('rejects an id of the wrong shape', () => {
    // Guards against silently accepting a channel or playlist id.
    expect(parseVideoUrl('https://www.youtube.com/watch?v=tooshort').ok).toBe(false);
  });

  it('rejects other sites and names the host', () => {
    const result = parseVideoUrl('https://vimeo.com/123456789');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('vimeo.com');
  });

  it('does not accept a lookalike domain', () => {
    expect(parseVideoUrl('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ').ok).toBe(false);
  });
});

describe('parseRows', () => {
  it('keeps good rows and reports bad ones against their sheet row number', () => {
    const { videos, warnings } = parseRows([
      ['https://youtu.be/dQw4w9WgXcQ', 'Genshin Summer', 'creator_one', 'ops@contentlab'],
      ['not a link', 'Genshin Summer', 'creator_two', 'ops@contentlab'],
      [], // blank spacer row -- normal, and silent
      ['https://vimeo.com/1', 'Govee Q3', 'creator_three', ''],
    ]);

    expect(videos).toHaveLength(1);
    expect(videos[0]?.row).toBe(2);
    expect(warnings).toHaveLength(2);
    // The row number is the whole point: ops needs to know what to fix.
    expect(warnings[0]?.message).toContain('Row 3');
    expect(warnings[1]?.message).toContain('Row 5');
  });

  it('ignores a duplicate and points at the row it duplicates', () => {
    const { videos, warnings } = parseRows([
      ['https://youtu.be/dQw4w9WgXcQ', 'A', 'creator_one', ''],
      // Same video, different URL form -- deduping on the id catches it where
      // deduping on the URL string would not.
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'A', 'creator_one', ''],
    ]);

    expect(videos).toHaveLength(1);
    expect(warnings[0]?.kind).toBe('duplicate');
    expect(warnings[0]?.message).toContain('row 2');
  });

  it('accepts a row with a valid link but missing metadata', () => {
    // Untidy is not the same as unusable. Dropping the row would lose tracking
    // over a blank cell.
    const { videos } = parseRows([['https://youtu.be/dQw4w9WgXcQ', '', '', '']]);

    expect(videos).toHaveLength(1);
    expect(videos[0]?.campaign).toBe('(no campaign)');
    expect(videos[0]?.creator).toBe('(unknown creator)');
  });
});

describe('flattenRow: Google Sheets smart chips', () => {
  it('prefers the hyperlink when the cell displays a title instead of a URL', () => {
    // Exactly what Sheets produces when a link is pasted with Ctrl+V: the
    // visible text becomes the page title and the URL survives only as link
    // metadata. Four rows silently stopped being tracked because of this.
    const row = flattenRow([
      { formattedValue: 'Govee Lights Don’t Fall Off (Here’s Why)', hyperlink: 'https://www.youtube.com/watch?v=Il5LW1Tb1II' },
      { formattedValue: 'Govee Smart Home' },
      { formattedValue: 'DIY Inspired' },
    ]);

    expect(row[0]).toBe('https://www.youtube.com/watch?v=Il5LW1Tb1II');
    expect(parseVideoUrl(row[0]!).ok).toBe(true);
  });

  it('uses the visible text when the cell is a plain typed URL', () => {
    const row = flattenRow([{ formattedValue: 'https://youtu.be/dQw4w9WgXcQ' }]);
    expect(row[0]).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('only trusts the hyperlink in the URL column', () => {
    // A campaign name that happens to be linked must stay a campaign name,
    // not silently become a URL.
    const row = flattenRow([
      { formattedValue: 'https://youtu.be/dQw4w9WgXcQ', hyperlink: 'https://youtu.be/dQw4w9WgXcQ' },
      { formattedValue: 'Govee Q3', hyperlink: 'https://example.com/brief' },
    ]);

    expect(row[1]).toBe('Govee Q3');
  });

  it('survives empty and missing cells', () => {
    expect(flattenRow([])).toEqual([]);
    expect(flattenRow([{}, { formattedValue: '' }])).toEqual(['', '']);
  });
});
