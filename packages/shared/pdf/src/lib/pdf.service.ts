import { Inject, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

import { PDF_CONFIG, PdfBlock, PdfConfig, PdfDocumentSpec } from './pdf.config';

const MARGIN = 56;
const FOOTER = 24;
const INK = '#1f2a26';
const MUTED = '#5b6b64';
/**
 * Ligatures off: a ligature glyph (fi, fl) breaks copying and searching the text (names, NIP, addresses), which matters
 * more in business documents than typographic polish. fontkit takes an object of feature switches.
 */
const PLAIN = {
  features: {
    liga: false,
    clig: false,
  } as unknown as PDFKit.Mixins.OpenTypeFeatures[],
};

/** Plain text for the document: control and bidi-override characters dropped, newlines kept (single-line text when asked). */
export function pdfText(value: unknown, singleLine = false): string {
  const text = [...String(value ?? '')]
    .filter((c) => {
      const n = c.codePointAt(0) ?? 0;
      if (n === 10) return !singleLine;
      return !(
        n < 32 ||
        (n >= 0x7f && n <= 0x9f) ||
        (n >= 0x202a && n <= 0x202e) ||
        (n >= 0x2066 && n <= 0x2069)
      );
    })
    .join('');
  return singleLine ? text.replace(/\s+/g, ' ').trim() : text;
}

type Doc = InstanceType<typeof PDFDocument>;

/**
 * Renders simple business documents (confirmations, statements) to PDF on the server: A4, embedded font subsets,
 * declarative blocks, an optional footer with page numbers. No remote resources are ever loaded.
 */
@Injectable()
export class PdfService {
  constructor(@Inject(PDF_CONFIG) private readonly config: PdfConfig) {}

  render(spec: PdfDocumentSpec): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: {
          top: MARGIN,
          left: MARGIN,
          right: MARGIN,
          bottom: MARGIN + FOOTER,
        },
        bufferPages: true,
        compress: this.config.compress ?? true,
        lang: spec.language ?? 'pl',
        displayTitle: true,
        info: {
          Title: pdfText(spec.title, true),
          Author: pdfText(spec.author ?? '', true),
          Subject: pdfText(spec.subject ?? '', true),
          Creator: '@smartsoft001/pdf',
          Producer: '@smartsoft001/pdf',
          CreationDate: spec.date ?? new Date(),
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      try {
        const fonts = this.config.fonts;
        doc.registerFont('regular', fonts ? fonts.regular : 'Helvetica');
        doc.registerFont('bold', fonts ? fonts.bold : 'Helvetica-Bold');
        doc.font('regular').fillColor(INK);
        for (const block of spec.blocks) this.block(doc, block);
        if (spec.footer !== undefined)
          this.footer(
            doc,
            pdfText(spec.footer, true),
            spec.pageLabel ?? 'strona',
          );
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private get width(): number {
    return 595.28 - 2 * MARGIN;
  }

  private block(doc: Doc, block: PdfBlock): void {
    switch (block.type) {
      case 'title':
        doc
          .font('bold')
          .fontSize(17)
          .fillColor(INK)
          .text(pdfText(block.text, true), { ...PLAIN, lineGap: 2 });
        doc.moveDown(0.6);
        return;
      case 'heading':
        this.room(doc, 48);
        doc
          .moveDown(0.7)
          .font('bold')
          .fontSize(11.5)
          .fillColor(INK)
          .text(pdfText(block.text, true), PLAIN);
        doc.moveDown(0.3);
        return;
      case 'paragraph':
        doc
          .font('regular')
          .fontSize(9.5)
          .fillColor(INK)
          .text(pdfText(block.text), { ...PLAIN, lineGap: 2.2 });
        doc.moveDown(0.45);
        return;
      case 'note':
        doc
          .font('regular')
          .fontSize(8)
          .fillColor(MUTED)
          .text(pdfText(block.text), { ...PLAIN, lineGap: 1.5 });
        doc.fillColor(INK).moveDown(0.4);
        return;
      case 'fields':
        for (const [label, value] of block.rows) {
          doc
            .font('bold')
            .fontSize(9.5)
            .fillColor(INK)
            .text(pdfText(label, true) + ': ', {
              ...PLAIN,
              continued: true,
              lineGap: 2,
            });
          doc
            .font('regular')
            .text(pdfText(value, true) || '—', { ...PLAIN, lineGap: 2 });
        }
        doc.moveDown(0.45);
        return;
      case 'table':
        this.table(doc, block);
        return;
      case 'pageBreak':
        doc.addPage();
        return;
    }
  }

  /** Starts a new page when less than `height` points remain, so headings are not left alone at the bottom. */
  private room(doc: Doc, height: number): void {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom)
      doc.addPage();
  }

  private table(doc: Doc, block: Extract<PdfBlock, { type: 'table' }>): void {
    const total = block.columns.reduce((sum, c) => sum + (c.width ?? 1), 0);
    const widths = block.columns.map(
      (c) => (this.width * (c.width ?? 1)) / total,
    );
    const left = MARGIN,
      pad = 4;
    const row = (cells: string[], bold: boolean) => {
      doc.font(bold ? 'bold' : 'regular').fontSize(9);
      const texts = block.columns.map((_, i) => pdfText(cells[i] ?? '', true));
      const height =
        Math.max(
          ...texts.map((t, i) =>
            doc.heightOfString(t, { ...PLAIN, width: widths[i] - 2 * pad }),
          ),
        ) +
        2 * pad;
      if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        if (!bold)
          row(
            block.columns.map((c) => c.label),
            true,
          );
      }
      const top = doc.y;
      let x = left;
      texts.forEach((t, i) => {
        doc.text(t, x + pad, top + pad, {
          ...PLAIN,
          width: widths[i] - 2 * pad,
          align: block.columns[i].align ?? 'left',
        });
        x += widths[i];
      });
      doc
        .moveTo(left, top + height)
        .lineTo(left + this.width, top + height)
        .lineWidth(bold ? 0.8 : 0.4)
        .strokeColor(bold ? INK : '#c9d3cd')
        .stroke();
      doc.x = left;
      doc.y = top + height;
    };
    row(
      block.columns.map((c) => c.label),
      true,
    );
    for (const cells of block.rows) row(cells, false);
    doc.moveDown(0.6);
  }

  private footer(doc: Doc, text: string, pageLabel: string): void {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom margin would open a new page.
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font('regular')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(
          `${text}${text ? ' · ' : ''}${pageLabel} ${i + 1} / ${range.count}`,
          MARGIN,
          doc.page.height - MARGIN,
          {
            ...PLAIN,
            width: this.width,
            align: 'center',
            lineBreak: false,
          },
        );
      doc.page.margins.bottom = bottom;
    }
  }
}
