import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { SERVICES } from '@smartsoft001/crud-shell-app-services';
import { SharedConfig, SharedModule } from '@smartsoft001/nestjs';

import { CONTROLLERS } from './controllers';
import { ICrudQueryConfig } from './crud-query.config';
import { crudStorage, ICrudStorageOptions } from './crud-storage';
import { GATEWAYS } from './gateways';
import { AuthJwtGuard } from './guards/auth/auth.guard';

@Module({})
export class CrudShellNestjsModule {
  static forRoot<T>(
    options: SharedConfig & {} & ICrudStorageOptions & {
        restApi: boolean;
        socket: boolean;
      } & ICrudQueryConfig,
  ): DynamicModule {
    // Without a token config the REST API is served without JWT auth, as before.
    const tokenConfig = options.tokenConfig;
    // The model type reaches CrudService through SharedConfig, for validation.
    const config = { ...options, type: options.type ?? options.db?.type };
    const storage = crudStorage(options);

    return {
      module: CrudShellNestjsModule,
      controllers: options.restApi ? CONTROLLERS : [],
      providers: [
        ...SERVICES,
        ...(options.socket ? GATEWAYS : []),
        AuthJwtGuard,
      ],
      imports: [
        ...((options.restApi || options.socket) &&
        tokenConfig?.secretOrPrivateKey
          ? [
              PassportModule.register({
                defaultStrategy: 'jwt',
                session: false,
              }),
              JwtModule.register({
                secret: tokenConfig.secretOrPrivateKey,
                signOptions: {
                  expiresIn: tokenConfig.expiredIn,
                },
              }),
            ]
          : []),
        SharedModule.forFeature(config),
        storage,
      ],
      exports: [...SERVICES, AuthJwtGuard, storage],
    };
  }
}

@Module({})
export class CrudShellNestjsCoreModule {
  /**
   * The core module always registers JWT auth, so the token config is not
   * optional here: a missing one used to fail at startup with a TypeError.
   */
  static forRoot<T>(
    options: SharedConfig & {
      tokenConfig: NonNullable<SharedConfig['tokenConfig']>;
    } & ICrudStorageOptions,
  ): DynamicModule {
    const config = { ...options, type: options.type ?? options.db?.type };

    return {
      module: CrudShellNestjsCoreModule,
      providers: [...SERVICES, ...GATEWAYS, AuthJwtGuard],
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt', session: false }),
        JwtModule.register({
          secret: options.tokenConfig.secretOrPrivateKey,
          signOptions: {
            expiresIn: options.tokenConfig.expiredIn,
          },
        }),
        // forRoot only wraps forFeature (its db settings are unused), so the core module needs no MongoDB settings.
        SharedModule.forFeature(config),
        crudStorage(options),
      ],
      exports: [],
    };
  }
}
