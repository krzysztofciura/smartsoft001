# @smartsoft001/pdf

Server-side PDF documents for business use (confirmations, statements) on [pdfkit](https://pdfkit.org): A4, embedded font subsets, declarative blocks and an optional footer with page numbers. Nothing is loaded from the network.

```ts
import { PdfModule, PdfService } from '@smartsoft001/pdf';

@Module({ imports: [PdfModule.forRoot({ fonts: { regular: 'assets/Font-Regular.ttf', bold: 'assets/Font-SemiBold.ttf' } })] })
export class DocumentsModule {}

const pdf: Buffer = await pdfService.render({
  title: 'Potwierdzenie zawarcia umowy',
  date: order.createdAt,
  blocks: [
    { type: 'title', text: 'Potwierdzenie zawarcia umowy' },
    { type: 'fields', rows: [['Numer', '7K4M-9Q2X']] },
    { type: 'heading', text: 'Pozycje' },
    { type: 'table', columns: [{ label: 'Usługa', width: 3 }, { label: 'Cena', align: 'right' }], rows: [['Morfologia', '25,00 zł']] },
    { type: 'paragraph', text: 'Treść…' },
    { type: 'note', text: 'Wersja testowa.' },
  ],
  footer: 'Zamówienie 7K4M-9Q2X',
});
```

- Blocks: `title`, `heading`, `paragraph` (newlines kept), `note` (small grey text), `fields` (label: value), `table` (relative widths, left/right alignment; the header repeats after a page break), `pageBreak`.
- Fonts: give TrueType/OpenType files (path or bytes). Without them Helvetica is used, which covers only Latin-1 — Polish text needs fonts.
- Text is written as plain text: control and bidi-override characters are dropped (`pdfText`).
- The footer is written on every page with `strona N / M` (`pageLabel` changes the word) without creating extra pages.
- `compress: false` keeps streams uncompressed for inspection.
