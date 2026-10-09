import { DynamicModule } from '@nestjs/common';

import { SharedConfig } from '@smartsoft001/nestjs';

import { CrudController } from './controllers';
import {
  CrudShellNestjsCoreModule,
  CrudShellNestjsModule,
} from './nestjs.module';

const options = {
  tokenConfig: {
    secretOrPrivateKey: 'secret',
    expiredIn: 3600,
  },
  db: {
    host: 'localhost',
    port: 27017,
    database: 'test',
  },
};

class Note {
  id!: string;
}

class OtherNote {
  id!: string;
}

function findSharedConfig(dynamicModule: DynamicModule): SharedConfig | null {
  const imports = (dynamicModule.imports ?? []) as Array<any>;

  for (const item of imports) {
    if (!item) {
      continue;
    }

    const provider = Array.isArray(item.providers)
      ? item.providers.find((p: any) => p && p.provide === SharedConfig)
      : null;

    if (provider) {
      return provider.useValue;
    }

    const nested = findSharedConfig(item);

    if (nested) {
      return nested;
    }
  }

  return null;
}

describe('crud-nestjs: CrudShellNestjsCoreModule', () => {
  it('should register the dynamic module against its own class', () => {
    const dynamicModule = CrudShellNestjsCoreModule.forRoot(options);

    expect(dynamicModule.module).toBe(CrudShellNestjsCoreModule);
  });

  it('should propagate the db model type to the shared config', () => {
    const dynamicModule = CrudShellNestjsCoreModule.forRoot({
      ...options,
      db: { ...options.db, type: Note },
    });

    expect(findSharedConfig(dynamicModule)?.type).toBe(Note);
  });
});

describe('crud-nestjs: CrudShellNestjsModule', () => {
  it('should propagate the db model type to the shared config', () => {
    const dynamicModule = CrudShellNestjsModule.forRoot({
      ...options,
      db: { ...options.db, type: Note },
      restApi: false,
      socket: false,
    });

    expect(findSharedConfig(dynamicModule)?.type).toBe(Note);
  });

  it('should prefer the explicit type over the db model type', () => {
    const dynamicModule = CrudShellNestjsModule.forRoot({
      ...options,
      type: OtherNote,
      db: { ...options.db, type: Note },
      restApi: false,
      socket: false,
    });

    expect(findSharedConfig(dynamicModule)?.type).toBe(OtherNote);
  });

  it('should hand the query limits to CrudController through SharedConfig', () => {
    const dynamicModule = CrudShellNestjsModule.forRoot({
      ...options,
      restApi: true,
      socket: false,
      maxQueryLimit: 500,
      maxExportLimit: 50000,
    });

    const deps = Reflect.getMetadata('self:paramtypes', CrudController);

    expect(findSharedConfig(dynamicModule)).toMatchObject({
      maxQueryLimit: 500,
      maxExportLimit: 50000,
    });
    expect(deps).toContainEqual({ index: 1, param: SharedConfig });
  });
});

describe('crud-nestjs: storage', () => {
  const persistence: DynamicModule = {
    module: class SupabaseLikeModule {},
    providers: [],
    exports: [],
  };

  it('should import and export the given persistence module instead of MongoDB', () => {
    // Arrange
    const { db: _db, ...withoutDb } = options;

    // Act
    const dynamicModule = CrudShellNestjsModule.forRoot({
      ...withoutDb,
      persistence,
      restApi: false,
      socket: false,
    });

    // Assert
    expect(dynamicModule.imports).toContain(persistence);
    expect(dynamicModule.exports).toContain(persistence);
  });

  it('should keep MongoDB as the default storage', () => {
    // Act
    const dynamicModule = CrudShellNestjsModule.forRoot({
      ...options,
      restApi: false,
      socket: false,
    });

    // Assert
    expect(
      (dynamicModule.imports as DynamicModule[]).some(
        (item) => item?.module?.name === 'MongoModule',
      ),
    ).toBe(true);
  });

  it('should use the persistence module in the core module too', () => {
    // Act
    const dynamicModule = CrudShellNestjsCoreModule.forRoot({
      tokenConfig: options.tokenConfig,
      persistence,
    });

    // Assert
    expect(dynamicModule.imports).toContain(persistence);
  });

  it('should refuse a module without any storage', () => {
    // Act & Assert
    expect(() =>
      CrudShellNestjsModule.forRoot({
        tokenConfig: options.tokenConfig,
        restApi: false,
        socket: false,
      }),
    ).toThrow('A CRUD module needs db (MongoDB) or persistence');
  });
});
