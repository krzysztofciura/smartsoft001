import { PaynowConfig, PaynowService } from '@smartsoft001/paynow';
import { RevolutConfig, RevolutService } from '@smartsoft001/revolut';

import {
  TransShellNestjsCoreModule,
  TransShellNestjsModule,
} from './nestjs.module';

// Mock PayPal SDK before importing it
jest.mock('paypal-rest-sdk', () => ({
  payment: {
    create: jest.fn(),
    execute: jest.fn(),
    get: jest.fn(),
  },
  sale: {
    refund: jest.fn(),
  },
  configure: jest.fn(),
}));

const baseConfig = {
  internalApiUrl: 'http://localhost/internal',
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

const paynowConfig: PaynowConfig = {
  apiKey: 'api-key',
  apiSignatureKey: 'signature-key',
  continueUrl: 'http://localhost/continue',
};

const revolutConfig: RevolutConfig = {
  token: 'revolut-token',
};

describe('trans-nestjs: TransShellNestjsModule', () => {
  it('should export Paynow config and service when paynow is configured', () => {
    const dynamicModule = TransShellNestjsModule.forRoot({
      ...baseConfig,
      paynowConfig,
    });

    expect(dynamicModule.exports).toEqual(
      expect.arrayContaining([PaynowConfig, PaynowService]),
    );
  });
});

describe('trans-nestjs: TransShellNestjsCoreModule', () => {
  it('should provide Revolut config and service when revolut is configured', () => {
    const dynamicModule = TransShellNestjsCoreModule.forRoot({
      ...baseConfig,
      revolutConfig,
    });

    expect(dynamicModule.providers).toEqual(
      expect.arrayContaining([
        { provide: RevolutConfig, useValue: revolutConfig },
        RevolutService,
      ]),
    );
  });
});

describe('trans-nestjs: storage', () => {
  it('should hand the persistence module to the CRUD module of the Trans entity', () => {
    // Arrange
    const persistence = {
      module: class TransStorageModule {},
      providers: [],
      exports: [],
    };
    const { db: _db, ...withoutDb } = baseConfig;

    // Act
    const dynamicModule = TransShellNestjsModule.forRoot({
      ...withoutDb,
      persistence,
    });
    const crud = (dynamicModule.imports as Array<{ imports?: unknown[] }>).find(
      (item) => item?.imports?.includes(persistence),
    );

    // Assert
    expect(crud).toBeDefined();
  });

  it('should keep the trans collection of MongoDB by default', () => {
    // Act
    const dynamicModule = TransShellNestjsCoreModule.forRoot(baseConfig);
    const mongo = JSON.stringify(dynamicModule.imports, (key, value) =>
      key === 'module' && typeof value === 'function' ? value.name : value,
    );

    // Assert
    expect(mongo).toContain('"collection":"trans"');
  });
});
