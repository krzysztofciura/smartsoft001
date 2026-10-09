import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import * as CryptoJS from 'crypto-js';
import { of, throwError } from 'rxjs';

import { PaynowConfig, PAYNOW_CONFIG_PROVIDER } from './paynow.config';
import { PaynowService } from './paynow.service';

const config: PaynowConfig = {
  apiKey: 'api-key',
  apiSignatureKey: 'signature-key',
  continueUrl: 'https://shop.example/continue',
  test: true,
};

const paid = {
  data: {},
  history: [{ status: 'started', data: { orderId: 'P/1' } }],
} as any;

describe('paynow: amount refunds, statuses and configuration provider', () => {
  let http: { post: jest.Mock; get: jest.Mock };
  let moduleRef: { get: jest.Mock };
  let service: PaynowService;

  beforeEach(() => {
    jest.spyOn(Logger, 'warn').mockImplementation();
    jest.spyOn(Logger, 'error').mockImplementation();
    http = { post: jest.fn(), get: jest.fn() };
    moduleRef = {
      get: jest.fn(() => {
        throw new Error('not registered');
      }),
    };
    service = new PaynowService(
      http as unknown as HttpService,
      config,
      moduleRef as unknown as ModuleRef,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('signs the refund, sends the key as Idempotency-Key and maps the state', async () => {
    http.post.mockReturnValueOnce(
      of({ data: { refundId: 'R1', status: 'NEW' } }),
    );

    expect(
      await service.refundAmount(paid, {
        amount: 250,
        key: 'key-1',
        comment: 'Partial',
      }),
    ).toEqual({ refundId: 'R1', status: 'pending' });

    const [url, body, options] = http.post.mock.calls[0];
    expect(url).toBe('https://api.sandbox.paynow.pl/v1/payments/P%2F1/refunds');
    expect(body).toEqual({ amount: 250, description: 'Partial' });
    expect(options.headers['Idempotency-Key']).toBe('key-1');
    expect(options.headers.Signature).toBe(
      CryptoJS.enc.Base64.stringify(
        CryptoJS.HmacSHA256(JSON.stringify(body), 'signature-key'),
      ),
    );
  });

  it('keeps long refund keys within the Idempotency-Key limit', async () => {
    http.post.mockReturnValueOnce(
      of({ data: { refundId: 'R1', status: 'PENDING' } }),
    );

    await service.refundAmount(paid, {
      amount: 1,
      key: 'k'.repeat(64),
      comment: '',
    });

    const key = http.post.mock.calls[0][2].headers['Idempotency-Key'];
    expect(key).toHaveLength(45);
    expect(http.post.mock.calls[0][1]).toEqual({ amount: 1 });
  });

  it('reads the refund state', async () => {
    for (const [state, expected] of [
      ['SUCCESSFUL', 'succeeded'],
      ['FAILED', 'failed'],
      ['CANCELLED', 'failed'],
      ['PENDING', 'pending'],
    ]) {
      http.get.mockReturnValueOnce(
        of({ data: { refundId: 'R1', status: state } }),
      );
      expect(await service.refundStatus(paid, 'R1')).toEqual({
        refundId: 'R1',
        status: expected,
      });
    }
    expect(http.get.mock.calls[0][0]).toBe(
      'https://api.sandbox.paynow.pl/v1/refunds/R1/status',
    );
  });

  it('hides credentials of a failed refund', async () => {
    http.post.mockReturnValueOnce(
      throwError(() => ({
        response: { status: 409 },
        config: { headers: { 'Api-Key': 'api-key' } },
      })),
    );

    await expect(
      service.refundAmount(paid, { amount: 1, key: 'k', comment: '' }),
    ).rejects.toThrow(/^Paynow refund failed \(HTTP 409\)$/);
  });

  it('maps final payment states that are not confirmations to canceled', async () => {
    for (const [state, expected] of [
      ['NEW', 'pending'],
      ['ERROR', 'canceled'],
      ['EXPIRED', 'canceled'],
      ['ABANDONED', 'canceled'],
      ['CONFIRMED', 'completed'],
    ]) {
      http.get.mockReturnValueOnce(of({ data: { status: state } }));
      expect((await service.getStatus(paid)).status).toBe(expected);
    }
  });

  it('never falls back to the static configuration when the provider fails', async () => {
    const provider = {
      get: jest.fn(async () => {
        throw new Error('settings unavailable');
      }),
    };
    moduleRef.get.mockImplementation((token: string) =>
      token === PAYNOW_CONFIG_PROVIDER ? provider : undefined,
    );

    await expect(
      service.refundAmount(paid, { amount: 1, key: 'k', comment: '' }),
    ).rejects.toThrow('settings unavailable');
    expect(http.post).not.toHaveBeenCalled();
  });
});
