import { DomainValidationError } from '@smartsoft001/domain-core';

import { RefundService } from './refund.service';
import { Trans } from '../entities';
import { ITransPaymentService } from '../interfaces';

describe('trans-domain: RefundService.refundAmount and refundStatus', () => {
  let stored: Trans<any>;
  let repository: any;
  let payments: ITransPaymentService;
  let refundAmount: jest.Mock;
  let refundStatus: jest.Mock;
  let service: RefundService<any>;

  beforeEach(() => {
    stored = {
      id: 't1',
      status: 'completed',
      system: 'payu',
      amount: 1000,
      modifyDate: new Date(0),
      history: [],
      refreshLockId: null,
    } as unknown as Trans<any>;
    repository = {
      getById: jest.fn(async () => structuredClone(stored)),
      compareAndSet: jest.fn(async (_id: string, expected: any, set: any) => {
        if (
          Object.entries(expected).some(
            ([k, v]) => ((stored as any)[k] ?? null) !== v,
          )
        )
          return false;
        Object.assign(stored, set);
        return true;
      }),
      updatePartial: jest.fn(async (item: any) => Object.assign(stored, item)),
    };
    refundAmount = jest.fn(async () => ({
      refundId: 'r-1',
      status: 'pending',
      data: { raw: true },
    }));
    refundStatus = jest.fn(async () => ({
      refundId: 'r-1',
      status: 'succeeded',
    }));
    payments = {
      payu: { refundAmount, refundStatus } as any,
      paynow: {} as any,
    };
    service = new RefundService<any>(repository);
  });

  const request = (amount = 400, key = 'refund-1') => ({
    amount,
    key,
    comment: 'Customer request',
  });
  const entries = () =>
    stored.history.filter((h) => h.status === 'refund').map((h) => h.data);

  it('refuses invalid requests and systems without amount refunds', async () => {
    for (const bad of [
      { amount: 0, key: 'k', comment: '' },
      { amount: 1.5, key: 'k', comment: '' },
      { amount: 1, key: 'bad key', comment: '' },
      { amount: 1, key: 'k', comment: 'x'.repeat(201) },
    ])
      await expect(
        service.refundAmount('t1', payments, bad as any),
      ).rejects.toBeInstanceOf(DomainValidationError);
    stored.system = 'paynow';
    await expect(
      service.refundAmount('t1', payments, request()),
    ).rejects.toThrow('does not support amount refunds');
    expect(stored.refreshLockId).toBeNull();
  });

  it('records a partial refund under the lease and keeps the payment completed', async () => {
    const result = await service.refundAmount('t1', payments, request());

    expect(result).toEqual({ refundId: 'r-1', status: 'pending' });
    expect(refundAmount).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      request(),
    );
    expect(stored.status).toBe('completed');
    expect(stored.refreshLockId).toBeNull();
    expect(entries()).toEqual([
      {
        refund: {
          key: 'refund-1',
          amount: 400,
          refundId: 'r-1',
          status: 'pending',
        },
      },
    ]);
  });

  it('answers a repeated key from the history and refuses it for another amount', async () => {
    await service.refundAmount('t1', payments, request());
    const again = await service.refundAmount('t1', payments, request());

    expect(again).toEqual({ refundId: 'r-1', status: 'pending' });
    expect(refundAmount).toHaveBeenCalledTimes(1);
    await expect(
      service.refundAmount('t1', payments, request(300)),
    ).rejects.toThrow('another amount');
  });

  it('never refunds more than is left, counting pending and settled refunds', async () => {
    await service.refundAmount('t1', payments, request(700, 'a'));
    await expect(
      service.refundAmount('t1', payments, request(301, 'b')),
    ).rejects.toThrow('amount left');
    refundAmount.mockResolvedValueOnce({ refundId: 'r-2', status: 'failed' });
    await service.refundAmount('t1', payments, request(300, 'b'));
    expect(
      await service.refundAmount('t1', payments, request(300, 'c')),
    ).toEqual({ refundId: 'r-1', status: 'pending' });
  });

  it('records a provider failure without its details and retries the same key', async () => {
    const secret = 'synthetic-private-secret';
    refundAmount.mockRejectedValueOnce(
      Object.assign(new Error(secret), { response: { status: 502 } }),
    );

    await expect(
      service.refundAmount('t1', payments, request()),
    ).rejects.toThrow(secret);
    expect(JSON.stringify(stored.history)).not.toContain(secret);
    expect(entries()[0]).toEqual({
      refund: { key: 'refund-1', amount: 400, status: 'unknown' },
      error: {
        name: 'Error',
        message: 'Transaction refund failed (HTTP 502)',
        status: 502,
      },
    });
    expect(stored.status).toBe('completed');

    expect(await service.refundAmount('t1', payments, request())).toEqual({
      refundId: 'r-1',
      status: 'pending',
    });
    expect(refundAmount).toHaveBeenCalledTimes(2);
  });

  it('refuses while another instance holds the lease', async () => {
    stored.refreshLockId = 'other';
    stored.refreshLockUntil = new Date(Date.now() + 60000);

    await expect(
      service.refundAmount('t1', payments, request()),
    ).rejects.toThrow('busy');
    expect(refundAmount).not.toHaveBeenCalled();
  });

  it('writes without a lease when the repository cannot compare and set', async () => {
    delete repository.compareAndSet;

    await service.refundAmount('t1', payments, request());

    expect(repository.updatePartial).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1', history: expect.any(Array) }),
      null,
    );
    expect(entries()).toHaveLength(1);
  });

  it('settles a pending refund from the provider and answers settled ones from the history', async () => {
    await service.refundAmount('t1', payments, request());

    expect(await service.refundStatus('t1', payments, 'refund-1')).toEqual({
      refundId: 'r-1',
      status: 'succeeded',
    });
    expect(entries().at(-1)).toEqual({
      refund: {
        key: 'refund-1',
        amount: 400,
        refundId: 'r-1',
        status: 'succeeded',
      },
    });
    expect(await service.refundStatus('t1', payments, 'refund-1')).toEqual({
      refundId: 'r-1',
      status: 'succeeded',
    });
    expect(refundStatus).toHaveBeenCalledTimes(1);
    await expect(
      service.refundStatus('t1', payments, 'missing'),
    ).rejects.toThrow('Refund not found');
  });
});
