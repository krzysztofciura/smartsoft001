import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { of, throwError } from 'rxjs';

import { PayuConfig, PAYU_CONFIG_PROVIDER } from './payu.config';
import { PayuService } from './payu.service';

const config: PayuConfig = {
  posId: 'pos',
  clientId: 'client',
  clientSecret: 'secret&with=chars',
  notifyUrl: 'https://shop.example/notify',
  continueUrl: 'https://shop.example/continue',
  test: true,
};

const paid = {
  data: {},
  history: [{ status: 'started', data: { orderId: 'ORDER/1' } }],
} as any;

describe('payu: amount refunds and configuration provider', () => {
  let http: { post: jest.Mock; get: jest.Mock };
  let moduleRef: { get: jest.Mock };
  let service: PayuService;

  beforeEach(() => {
    jest.spyOn(Logger, 'warn').mockImplementation();
    jest.spyOn(Logger, 'error').mockImplementation();
    http = { post: jest.fn(), get: jest.fn() };
    moduleRef = {
      get: jest.fn(() => {
        throw new Error('not registered');
      }),
    };
    service = new PayuService(
      http as unknown as HttpService,
      config,
      moduleRef as unknown as ModuleRef,
    );
    http.post.mockReturnValueOnce(of({ data: { access_token: 'token' } }));
  });

  afterEach(() => jest.restoreAllMocks());

  it('sends the amount and the refund key and maps the PayU refund state', async () => {
    http.post.mockReturnValueOnce(
      of({
        data: {
          orderId: 'ORDER/1',
          refund: { refundId: 'R1', extRefundId: 'key-1', status: 'PENDING' },
        },
      }),
    );

    const result = await service.refundAmount(paid, {
      amount: 250,
      key: 'key-1',
      comment: 'Partial',
    });

    expect(result).toEqual({ refundId: 'R1', status: 'pending' });
    const [tokenUrl, tokenBody, tokenOptions] = http.post.mock.calls[0];
    expect(tokenUrl).toBe(
      'https://secure.snd.payu.com/pl/standard/user/oauth/authorize',
    );
    expect(new URLSearchParams(tokenBody).get('client_secret')).toBe(
      'secret&with=chars',
    );
    expect(tokenOptions.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const [url, body] = http.post.mock.calls[1];
    expect(url).toBe(
      'https://secure.snd.payu.com/api/v2_1/orders/ORDER%2F1/refunds',
    );
    expect(body).toEqual({
      refund: {
        description: 'Partial',
        amount: 250,
        extRefundId: 'key-1',
        currencyCode: 'PLN',
      },
    });
  });

  it('reads the refund state', async () => {
    for (const [state, expected] of [
      ['FINALIZED', 'succeeded'],
      ['CANCELED', 'failed'],
      ['PENDING', 'pending'],
    ]) {
      http.post.mockReturnValueOnce(of({ data: { access_token: 'token' } }));
      http.get.mockReturnValueOnce(
        of({ data: { refundId: 'R1', status: state } }),
      );
      expect(await service.refundStatus(paid, 'R1')).toEqual({
        refundId: 'R1',
        status: expected,
      });
    }
    expect(http.get.mock.calls[0][0]).toBe(
      'https://secure.snd.payu.com/api/v2_1/orders/ORDER%2F1/refunds/R1',
    );
  });

  it('hides credentials of a failed refund', async () => {
    http.post.mockReturnValueOnce(
      throwError(() => ({
        response: { status: 400 },
        config: { headers: { Authorization: 'Bearer token' } },
      })),
    );

    await expect(
      service.refundAmount(paid, { amount: 1, key: 'k', comment: '' }),
    ).rejects.toThrow(/^PayU refund failed \(HTTP 400\)$/);
  });

  it('uses the configuration provider and never falls back when it fails', async () => {
    const provider = { get: jest.fn(async () => ({ ...config, test: false })) };
    moduleRef.get.mockImplementation((token: string) =>
      token === PAYU_CONFIG_PROVIDER ? provider : undefined,
    );
    http.post.mockReset();
    http.post
      .mockReturnValueOnce(of({ data: { access_token: 'token' } }))
      .mockReturnValueOnce(
        of({ data: { refund: { refundId: 'R2', status: 'FINALIZED' } } }),
      );

    await service.refundAmount(paid, { amount: 1, key: 'k', comment: '' });
    expect(http.post.mock.calls[0][0]).toBe(
      'https://secure.payu.com/pl/standard/user/oauth/authorize',
    );
    expect(provider.get).toHaveBeenCalledWith(paid.data);

    provider.get.mockRejectedValueOnce(new Error('settings unavailable'));
    await expect(
      service.refundAmount(paid, { amount: 1, key: 'k', comment: '' }),
    ).rejects.toThrow('settings unavailable');
    expect(http.post).toHaveBeenCalledTimes(2);
  });
});
