import { Test } from '@nestjs/testing';

import { join } from 'node:path';

import { PdfConfig } from './pdf.config';
import { PdfModule } from './pdf.module';
import { PdfService, pdfText } from './pdf.service';

const fonts = {
  regular: join(__dirname, '../test/fonts/Geist-Regular.ttf'),
  bold: join(__dirname, '../test/fonts/Geist-SemiBold.ttf'),
};
const pages = (pdf: Buffer) =>
  Number(
    /\/Type \/Pages[\s\S]*?\/Count (\d+)/.exec(pdf.toString('latin1'))?.[1],
  );
const service = async (config?: PdfConfig) =>
  (
    await Test.createTestingModule({
      imports: [PdfModule.forRoot(config)],
    }).compile()
  ).get(PdfService);

describe('shared-pdf: PdfService', () => {
  it('renders an A4 PDF with the embedded fonts and Polish text on one page', async () => {
    const pdf = await (
      await service({ fonts })
    ).render({
      title: 'Potwierdzenie zawarcia umowy',
      date: new Date('2026-10-09T10:00:00Z'),
      blocks: [
        { type: 'title', text: 'Potwierdzenie zawarcia umowy' },
        { type: 'fields', rows: [['Nabywca', 'Zażółć gęślą jaźń sp. z o.o.']] },
        { type: 'heading', text: 'Zamówione usługi' },
        {
          type: 'table',
          columns: [
            { label: 'Usługa', width: 3 },
            { label: 'Cena', align: 'right' },
          ],
          rows: [['Morfologia krwi', '25,00 zł']],
        },
        { type: 'paragraph', text: 'Pierwszy akapit.\nDrugi wiersz.' },
        { type: 'note', text: 'Wersja testowa.' },
      ],
      footer: 'Zamówienie 7K4M-9Q2X',
    });

    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.')).toBe(true);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+Geist-Regular/);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+Geist-SemiBold/);
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(pages(pdf)).toBe(1);
  });

  it('continues long tables on new pages and numbers every page without adding blank ones', async () => {
    const rows = Array.from({ length: 140 }, (_, i) => [
      `Pozycja ${i + 1}`,
      `${i},00 zł`,
    ]);
    const pdf = await (
      await service({ fonts })
    ).render({
      title: 'Zestawienie',
      blocks: [
        {
          type: 'table',
          columns: [{ label: 'Pozycja' }, { label: 'Kwota', align: 'right' }],
          rows,
        },
      ],
      footer: 'Zestawienie testowe',
    });

    expect(pages(pdf)).toBeGreaterThanOrEqual(3);
    expect(pages(pdf)).toBeLessThanOrEqual(5);
  });

  it('falls back to Helvetica for Latin-1 text and writes the document information', async () => {
    const pdf = await (
      await service({ compress: false })
    ).render({
      title: 'Statement',
      author: 'Shop',
      blocks: [{ type: 'paragraph', text: 'Plain ASCII text.' }],
    });

    const text = pdf.toString('latin1');
    expect(text).toContain('/BaseFont /Helvetica');
    expect(text).toMatch(/\/Title \d+ 0 R/);
    expect(text).toContain('(Statement)');
    expect(text).toContain('(Shop)');
    expect(pages(pdf)).toBe(1);
  });

  it('writes non-Latin-1 titles as UTF-16 in the document information', async () => {
    const pdf = await (
      await service({ fonts })
    ).render({ title: 'Łódź', blocks: [] });

    // A UTF-16BE string with its byte order mark: FE FF 01 41 (Ł) ...
    expect(pdf.includes(Buffer.from([0x28, 0xfe, 0xff, 0x01, 0x41]))).toBe(
      true,
    );
  });
});

describe('shared-pdf: pdfText', () => {
  it('drops control and bidi-override characters, keeps newlines unless single-line', () => {
    const value =
      'A' + String.fromCharCode(7) + 'B' + String.fromCharCode(0x202e) + 'C\nD';

    expect(pdfText(value)).toBe('ABC\nD');
    expect(pdfText(value, true)).toBe('ABCD');
    expect(pdfText('  a \n  b  ', true)).toBe('a b');
    expect(pdfText(undefined)).toBe('');
  });
});
