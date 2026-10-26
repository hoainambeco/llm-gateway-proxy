import { parseMarkdownImagesToGeminiParts } from './MarkdownImageParts';

describe('MarkdownImageParts', () => {
  it('parses text without markdown images as a single text part', () => {
    const parts = parseMarkdownImagesToGeminiParts('Hello world, no images here.');
    expect(parts).toEqual([{ text: 'Hello world, no images here.' }]);
  });

  it('returns empty array for empty or whitespace-only text without images', () => {
    expect(parseMarkdownImagesToGeminiParts('')).toEqual([]);
    expect(parseMarkdownImagesToGeminiParts('   \n  ')).toEqual([]);
  });

  it('extracts inline base64 image and text parts in correct order', () => {
    const markdown =
      'Before image ![diagram](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=) After image';

    const parts = parseMarkdownImagesToGeminiParts(markdown);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ text: 'Before image ' });
    expect(parts[1]).toEqual({
      inlineData: {
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      },
    });
    expect(parts[2]).toEqual({ text: ' After image' });
  });

  it('extracts multiple consecutive images and ignores blank whitespace text parts', () => {
    const markdown =
      '![img1](data:image/jpeg;base64,AAAA) \n ![img2](data:image/webp;base64,BBBB)';

    const parts = parseMarkdownImagesToGeminiParts(markdown);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({
      inlineData: { mimeType: 'image/jpeg', data: 'AAAA' },
    });
    expect(parts[1]).toEqual({
      inlineData: { mimeType: 'image/webp', data: 'BBBB' },
    });
  });
});
