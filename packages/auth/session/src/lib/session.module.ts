import {
  DynamicModule,
  MiddlewareConsumer,
  NestModule,
  Provider,
  Type,
} from '@nestjs/common';

import { SessionConfig } from './session.config';
import {
  SessionAccessController,
  SessionBodyMiddleware,
  SessionController,
  SessionErrorFilter,
  SessionHttpOptions,
  SessionTeamController,
} from './session.controller';
import { SessionService } from './session.service';
import { SessionTeamOptions, SessionTeamService } from './session.team';
import {
  IIdentityProvider,
  ISessionStore,
  ISessionTeamStore,
} from './session.types';

export interface ISessionModuleOptions extends SessionHttpOptions {
  /** A service built by the application, when it also uses the service outside Nest. */
  service?: SessionService;
  /** Otherwise the module builds the service from these three. */
  config?: SessionConfig;
  store?: ISessionStore;
  provider?: IIdentityProvider;
  /**
   * Team management (`admin/team`): roles written by `store`, a login allowed
   * to write them (the session runtime is not), managed by holders of
   * `permission`.
   */
  team?: SessionTeamOptions & { store: ISessionTeamStore };
}

/**
 * Server-side account sessions (`SessionController` under `auth/`,
 * `SessionAccessController` under `admin/`, with `team` also
 * `SessionTeamController` under `admin/team`) and `SessionService` for other
 * modules. Mount it under the API prefix with `RouterModule`.
 *
 * @example
 * imports: [
 *   SessionModule.forRoot({
 *     config: { origin, key, secure: true, mailEnabled: true, roles: { owner: ['store:manage'] } },
 *     store: new PgSessionStore(pool, 'auth_session'),
 *     provider: new SupabaseIdentityProvider(new SupabaseAuthService({ authUrl } as SupabaseConfig), { issuer: 'Shop' }),
 *   }),
 *   RouterModule.register([{ path: 'api/v1', module: SessionModule }]),
 * ]
 */
export class SessionModule implements NestModule {
  static forRoot(options: ISessionModuleOptions): DynamicModule {
    const http: SessionHttpOptions = {
      messages: options.messages,
      exporter: options.exporter,
      exportFormat: options.exportFormat,
      exportFile: options.exportFile,
    };
    const providers: Provider[] = [
      { provide: SessionHttpOptions, useValue: http },
      SessionErrorFilter,
      SessionBodyMiddleware,
    ];
    if (options.service) {
      providers.push(
        { provide: SessionService, useValue: options.service },
        { provide: SessionConfig, useValue: options.service.config },
      );
    } else {
      if (!options.config || !options.store || !options.provider)
        throw new Error(
          'SessionModule needs a service, or config, store and provider',
        );
      providers.push(
        { provide: SessionConfig, useValue: options.config },
        { provide: ISessionStore, useValue: options.store },
        { provide: IIdentityProvider, useValue: options.provider },
        SessionService,
      );
    }
    const controllers: Type[] = [SessionController, SessionAccessController];
    const exported: Type[] = [];
    if (options.team) {
      const { store, ...team } = options.team;
      providers.push(
        { provide: SessionTeamOptions, useValue: team },
        { provide: ISessionTeamStore, useValue: store },
        SessionTeamService,
      );
      controllers.push(SessionTeamController);
      exported.push(SessionTeamService);
    }
    return {
      module: SessionModule,
      controllers,
      providers,
      exports: [SessionService, SessionConfig, ...exported],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(SessionBodyMiddleware)
      .forRoutes(SessionController, SessionTeamController);
  }
}
