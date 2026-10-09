export const PDF_CONFIG = 'PDF_CONFIG';

export interface PdfConfig {
  /**
   * TrueType/OpenType fonts (path or bytes) embedded as subsets. Without them the standard Helvetica is used, which
   * covers only Latin-1 — Polish and most other languages need fonts here.
   */
  fonts?: { regular: string | Buffer; bold: string | Buffer };
  /** Stream compression; on by default (off only to inspect the output). */
  compress?: boolean;
}

export type PdfBlock =
  | { type: 'title'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  /** Small grey text (notes, legal pointers). */
  | { type: 'note'; text: string }
  /** Label and value pairs, one per line. */
  | { type: 'fields'; rows: [string, string][] }
  /** Columns with relative widths (default equal) and alignment; the header repeats after a page break. */
  | {
      type: 'table';
      columns: { label: string; width?: number; align?: 'left' | 'right' }[];
      rows: string[][];
    }
  | { type: 'pageBreak' };

export interface PdfDocumentSpec {
  title: string;
  author?: string;
  subject?: string;
  /** BCP 47 language of the content; defaults to `pl`. */
  language?: string;
  /** Creation date written into the document information. */
  date?: Date;
  blocks: PdfBlock[];
  /** Text at the bottom of every page, followed by "page / pages". */
  footer?: string;
  /** Word used before the page number in the footer; defaults to `strona`. */
  pageLabel?: string;
}
