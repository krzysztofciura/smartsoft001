import { DynamicModule, Module } from '@nestjs/common';

import { PDF_CONFIG, PdfConfig } from './pdf.config';
import { PdfService } from './pdf.service';

/** `PdfModule.forRoot({fonts})` provides {@link PdfService}. */
@Module({})
export class PdfModule {
  static forRoot(config: PdfConfig = {}): DynamicModule {
    return {
      module: PdfModule,
      providers: [{ provide: PDF_CONFIG, useValue: config }, PdfService],
      exports: [PdfService],
    };
  }
}
