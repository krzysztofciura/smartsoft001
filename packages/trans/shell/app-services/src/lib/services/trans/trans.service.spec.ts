import { HttpService } from '@nestjs/axios';
import { ModuleRef } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';

import {
  DomainValidationError,
  IItemRepository,
} from '@smartsoft001/domain-core';
import { PaynowService } from '@smartsoft001/paynow';
import { PaypalService } from '@smartsoft001/paypal';
import { PayuService } from '@smartsoft001/payu';
import { RevolutService } from '@smartsoft001/revolut';
import {
  CreatorService,
  RefresherService,
  RefundService,
  Trans,
  TransConfig,
  TransSystem,
} from '@smartsoft001/trans-domain';

import { TransService } from './trans.service';

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

describe('trans: TransService', () => {
  let service: TransService;
  let mockModuleRef: jest.Mocked<ModuleRef>;
  let mockCreatorService: jest.Mocked<CreatorService<any>>;
  let mockRefresherService: jest.Mocked<RefresherService<any>>;
  let mockRefundService: jest.Mocked<RefundService<any>>;
  let mockHttpService: jest.Mocked<HttpService>;
  let mockConfig: TransConfig;
  let mockRepository: jest.Mocked<IItemRepository<Trans<any>>>;
  let mockPayuService: jest.Mocked<PayuService>;
  let mockPaynowService: jest.Mocked<PaynowService>;
  let mockPaypalService: jest.Mocked<PaypalService>;
  let mockRevolutService: jest.Mocked<RevolutService>;
  let mockInternalService: any;

  beforeEach(async () => {
    mockModuleRef = {
      get: jest.fn(),
    } as any;

    mockCreatorService = {
      create: jest.fn(),
    } as any;

    mockRefresherService = {
      refresh: jest.fn(),
    } as any;

    mockRefundService = {
      refund: jest.fn(),
      refundAmount: jest.fn(),
      refundStatus: jest.fn(),
    } as any;

    mockHttpService = {
      post: jest.fn(),
      put: jest.fn(),
    } as any;

    mockConfig = {
      internalApiUrl: 'http://test-api.com',
    } as any;

    mockRepository = {
      getById: jest.fn(),
    } as any;

    mockPayuService = {
      create: jest.fn(),
      getStatus: jest.fn(),
      refund: jest.fn(),
    } as any;

    mockPaynowService = {
      create: jest.fn(),
      getStatus: jest.fn(),
      refund: jest.fn(),
    } as any;

    mockPaypalService = {
      create: jest.fn(),
      getStatus: jest.fn(),
      refund: jest.fn(),
    } as any;

    mockRevolutService = {
      create: jest.fn(),
      getStatus: jest.fn(),
      refund: jest.fn(),
    } as any;

    mockInternalService = {
      create: jest.fn(),
      refreshOnce: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransService,
        {
          provide: ModuleRef,
          useValue: mockModuleRef,
        },
        {
          provide: CreatorService,
          useValue: mockCreatorService,
        },
        {
          provide: RefresherService,
          useValue: mockRefresherService,
        },
        {
          provide: RefundService,
          useValue: mockRefundService,
        },
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
        {
          provide: TransConfig,
          useValue: mockConfig,
        },
        {
          provide: IItemRepository,
          useValue: mockRepository,
        },
        {
          provide: PayuService,
          useValue: mockPayuService,
        },
        {
          provide: PaynowService,
          useValue: mockPaynowService,
        },
        {
          provide: PaypalService,
          useValue: mockPaypalService,
        },
        {
          provide: RevolutService,
          useValue: mockRevolutService,
        },
      ],
    }).compile();

    service = module.get<TransService>(TransService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should call creator service with correct parameters', async () => {
      const mockOps = {
        amount: 100,
        system: 'payu' as TransSystem,
        name: 'Test Transaction',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        contactPhone: '123456789',
        data: {},
        options: {},
        clientIp: '127.0.0.1',
      };
      const mockResult = {
        orderId: 'test-order',
        redirectUrl: 'http://test.com',
      };
      mockCreatorService.create.mockResolvedValue(mockResult);
      mockModuleRef.get.mockReturnValue(mockInternalService);

      const result = await service.create(mockOps);

      expect(result).toEqual(mockResult);
    });
  });

  describe('refresh', () => {
    it('should call refresher service with correct parameters', async () => {
      const transId = 'test-trans-id';
      const mockData = { status: 'completed' };
      mockModuleRef.get.mockReturnValue(mockInternalService);

      await service.refresh(transId, mockData);

      expect(mockRefresherService.refresh).toHaveBeenCalledWith(
        transId,
        mockInternalService,
        expect.any(Object),
        mockData,
      );
    });
  });

  describe('refund', () => {
    it('should call refund service with correct parameters', async () => {
      const transId = 'test-trans-id';
      const comment = 'Test refund';
      mockModuleRef.get.mockReturnValue(mockInternalService);

      await service.refund(transId, comment);

      expect(mockRefundService.refund).toHaveBeenCalledWith(
        transId,
        mockInternalService,
        expect.any(Object),
        comment,
      );
    });
  });

  describe('refundAmount and refundStatus', () => {
    it('should pass the request and the payment services to the refund service', async () => {
      const request = { amount: 100, key: 'refund-1', comment: 'Partial' };
      mockRefundService.refundAmount.mockResolvedValue({
        refundId: 'r1',
        status: 'pending',
      });
      mockRefundService.refundStatus.mockResolvedValue({
        refundId: 'r1',
        status: 'succeeded',
      });

      expect(await service.refundAmount('trans-1', request)).toEqual({
        refundId: 'r1',
        status: 'pending',
      });
      expect(await service.refundStatus('trans-1', 'refund-1')).toEqual({
        refundId: 'r1',
        status: 'succeeded',
      });
      expect(mockRefundService.refundAmount).toHaveBeenCalledWith(
        'trans-1',
        expect.objectContaining({ payu: mockPayuService }),
        request,
      );
      expect(mockRefundService.refundStatus).toHaveBeenCalledWith(
        'trans-1',
        expect.objectContaining({ paynow: mockPaynowService }),
        'refund-1',
      );
    });
  });

  describe('getById', () => {
    it('should return transaction by id', async () => {
      const mockTrans = { id: 'test-id', status: 'completed' } as Trans<any>;
      mockRepository.getById.mockResolvedValue(mockTrans);

      const result = await service.getById('test-id');

      expect(result).toEqual(mockTrans);
    });
  });

  describe('getInternalService', () => {
    it('rejects HTTP fulfillment without an explicit idempotency contract', async () => {
      mockModuleRef.get.mockImplementation(() => {
        throw new Error('No custom provider');
      });
      const internal = (service as any).getInternalService();

      const result = internal.refreshOnce({ id: 'order' }, 'stable-key');

      expect(result).toBeInstanceOf(Promise);
      await expect(result).rejects.toThrow(
        new DomainValidationError(
          'An idempotent internal API must be configured',
        ),
      );
      expect(mockHttpService.put).not.toHaveBeenCalled();
    });

    it('rejects fulfillment in offline mode even with the idempotency flag', async () => {
      mockModuleRef.get.mockImplementation(() => {
        throw new Error('No custom provider');
      });
      mockConfig.internalApiUrl = '';
      mockConfig.idempotentInternalApi = true;
      const internal = (service as any).getInternalService();

      await expect(
        internal.refreshOnce({ id: 'order' }, 'stable-key'),
      ).rejects.toThrow('An idempotent internal API must be configured');
      expect(mockHttpService.put).not.toHaveBeenCalled();
    });

    it('forwards the stable key to an explicitly configured internal API', async () => {
      mockModuleRef.get.mockImplementation(() => {
        throw new Error('No custom provider');
      });
      mockConfig.idempotentInternalApi = true;
      mockHttpService.put.mockReturnValue(
        of({ data: { receipt: 'done' } }) as any,
      );
      const trans = { id: 'order/1' };
      const internal = (service as any).getInternalService();
      await expect(internal.refreshOnce(trans, 'stable-key')).resolves.toEqual({
        receipt: 'done',
      });
      expect(mockHttpService.put).toHaveBeenCalledWith(
        'http://test-api.com/order%2F1',
        trans,
        { headers: { 'Idempotency-Key': 'stable-key' } },
      );
    });

    it('should return internal service from module ref when available', () => {
      mockModuleRef.get.mockReturnValue(mockInternalService);

      const result = (service as any).getInternalService();

      expect(result).toBe(mockInternalService);
    });

    it('should return fallback internal service with create method when module ref fails', () => {
      mockModuleRef.get.mockImplementation(() => {
        throw new Error('Service not found');
      });

      const result = (service as any).getInternalService();

      expect(result).toHaveProperty('create');
    });

    it('should refuse to approve an amount without an internal api url', async () => {
      mockModuleRef.get.mockImplementation(() => {
        throw new Error('Service not found');
      });
      mockConfig.internalApiUrl = '';
      const fallback = (service as any).getInternalService();

      await expect(fallback.create({ id: 'trans-1' })).rejects.toThrow(
        new DomainValidationError(
          'No internal service approves the payment amount: set internalApiUrl or provide TRANS_TOKEN_INTERNAL_SERVICE',
        ),
      );
      expect(mockHttpService.post).not.toHaveBeenCalled();
    });

    it('should return a fallback internal service without the deprecated refresh', () => {
      mockModuleRef.get.mockImplementation(() => {
        throw new Error('Service not found');
      });

      const result = (service as any).getInternalService();

      expect(result).toHaveProperty('refreshOnce');
      expect(result).not.toHaveProperty('refresh');
    });
  });
});
