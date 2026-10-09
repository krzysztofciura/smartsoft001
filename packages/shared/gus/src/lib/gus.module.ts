import { DynamicModule, Module } from '@nestjs/common';

import { GUS_CONFIG, GUS_FETCH, GusConfig } from './gus.config';
import { GusService } from './gus.service';

/**
 * `GusModule.forRoot({environment, key})` provides {@link GusService} for NIP lookups in REGON. An own `fetch`
 * (a proxy, a test double) can be passed as the second argument.
 */
@Module({})
export class GusModule {
  static forRoot(config: GusConfig, fetcher?: typeof fetch): DynamicModule {
    return {
      module: GusModule,
      providers: [
        { provide: GUS_CONFIG, useValue: config },
        ...(fetcher ? [{ provide: GUS_FETCH, useValue: fetcher }] : []),
        GusService,
      ],
      exports: [GusService],
    };
  }
}
