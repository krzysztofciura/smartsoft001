import { Injectable, NotFoundException } from '@nestjs/common';

import {
  DomainValidationError,
  IItemRepository,
} from '@smartsoft001/domain-core';

import { randomUUID } from 'node:crypto';

import { Trans } from '../entities';
import {
  ITransInternalService,
  ITransPaymentService,
  ITransRefundRequest,
  ITransRefundResult,
} from '../interfaces';
import { TransBaseService } from '../trans.service';

/** A refund entry of the history (`data.refund`); the latest one per key wins. */
interface ITransRefundEntry {
  key: string;
  amount: number;
  refundId?: string;
  status: ITransRefundResult['status'] | 'unknown';
}

interface ILeaseOutcome {
  result?: ITransRefundResult;
  error?: unknown;
  changed?: boolean;
}

const REFUND_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const REFUND_STATES = ['pending', 'succeeded', 'failed'];

@Injectable()
export class RefundService<T> extends TransBaseService<T> {
  /** How long a refund holds the transaction before another instance may take over. */
  protected refundLeaseMs = 2 * 60 * 1000;

  constructor(repository: IItemRepository<Trans<T>>) {
    super(repository);
  }

  async refund(
    transId: string,
    internalService: ITransInternalService<T>,
    paymentService: ITransPaymentService,
    comment = 'Refund',
  ): Promise<void> {
    const trans = await this.repository.getById(transId);

    if (!trans) {
      throw new NotFoundException('Transaction not found: ' + transId);
    }

    if (trans.status !== 'completed') {
      throw new NotFoundException(
        'Transaction is not completed/error: ' + transId,
      );
    }

    try {
      const data = await paymentService[trans.system].refund(trans, comment);

      trans.modifyDate = new Date();
      trans.status = 'refund';
      data['customData'] = {
        comment,
      };
      this.addHistory(trans, data);

      await this.repository.update(trans, null);
    } catch (err) {
      // Provider errors can carry request credentials: never log them raw.
      // setError stores only the error name, a safe message and the status.
      await this.setError(trans, err, 'Transaction refund failed');

      throw err;
    }
  }

  /**
   * Returns part (or all) of a completed payment. Idempotent per
   * `request.key`: a repeated key answers the recorded refund without asking
   * the provider again, unless the previous call ended without an answer.
   * Refunds are history entries with the status `refund`; the transaction
   * keeps the status `completed`, which is what the provider still reports
   * for the payment. A failed provider call is recorded without its error
   * details and does not change the status.
   */
  async refundAmount(
    transId: string,
    paymentService: ITransPaymentService,
    request: ITransRefundRequest,
  ): Promise<ITransRefundResult> {
    if (
      !Number.isSafeInteger(request?.amount) ||
      request.amount < 1 ||
      typeof request.key !== 'string' ||
      !REFUND_KEY.test(request.key) ||
      typeof request.comment !== 'string' ||
      request.comment.length > 200
    )
      throw new DomainValidationError('Invalid refund request');

    return this.withLease(transId, async (trans) => {
      const provider = paymentService[trans.system];
      if (!provider?.refundAmount)
        throw new DomainValidationError(
          'The payment system does not support amount refunds',
        );
      const previous = this.refunds(trans).get(request.key);
      if (previous) {
        if (previous.amount !== request.amount)
          throw new DomainValidationError(
            'The refund key was used for another amount',
          );
        if (previous.status !== 'unknown' && previous.refundId)
          return {
            result: { refundId: previous.refundId, status: previous.status },
          };
      }
      if (trans.status !== 'completed')
        throw new DomainValidationError('Transaction is not completed');
      let reserved = 0;
      for (const entry of this.refunds(trans).values())
        if (entry.key !== request.key && entry.status !== 'failed')
          reserved += entry.amount;
      if (request.amount > trans.amount - reserved)
        throw new DomainValidationError(
          'The refund exceeds the amount left to refund',
        );

      trans.modifyDate = new Date();
      try {
        const result = this.validResult(
          await provider.refundAmount(trans, request),
        );
        this.addRefund(trans, {
          key: request.key,
          amount: request.amount,
          refundId: result.refundId,
          status: result.status,
        });
        return { result, changed: true };
      } catch (err) {
        this.addRefund(
          trans,
          { key: request.key, amount: request.amount, status: 'unknown' },
          this.errorEvent(err, 'Transaction refund failed'),
        );
        return { error: err, changed: true };
      }
    });
  }

  /** The provider's current state of the refund with this key; settled refunds are answered from the history. */
  async refundStatus(
    transId: string,
    paymentService: ITransPaymentService,
    key: string,
  ): Promise<ITransRefundResult> {
    return this.withLease(transId, async (trans) => {
      const entry = this.refunds(trans).get(key);
      if (!entry?.refundId)
        throw new NotFoundException('Refund not found: ' + key);
      if (entry.status === 'succeeded' || entry.status === 'failed')
        return { result: { refundId: entry.refundId, status: entry.status } };
      const provider = paymentService[trans.system];
      if (!provider?.refundStatus)
        return { result: { refundId: entry.refundId, status: 'pending' } };
      const result = this.validResult(
        await provider.refundStatus(trans, entry.refundId),
      );
      if (result.status === entry.status) return { result };
      trans.modifyDate = new Date();
      this.addRefund(trans, { ...entry, status: result.status });
      return { result, changed: true };
    });
  }

  private refunds(trans: Trans<any>): Map<string, ITransRefundEntry> {
    const entries = new Map<string, ITransRefundEntry>();
    for (const item of trans.history ?? []) {
      const refund = item?.data?.refund as ITransRefundEntry | undefined;
      if (item.status === 'refund' && refund && typeof refund.key === 'string')
        entries.set(refund.key, refund);
    }
    return entries;
  }

  private addRefund(
    trans: Trans<any>,
    refund: ITransRefundEntry,
    error?: unknown,
  ): void {
    this.addHistory(trans, error ? { refund, error } : { refund }, 'refund');
  }

  private validResult(result: ITransRefundResult): ITransRefundResult {
    if (
      typeof result?.refundId !== 'string' ||
      !result.refundId ||
      !REFUND_STATES.includes(result.status)
    )
      throw new Error('Invalid refund answer');
    return { refundId: result.refundId, status: result.status };
  }

  /**
   * Runs `work` on a fresh copy of the transaction while holding the refresh
   * lease (when the repository can compare and set), so refunds and status
   * refreshes of one transaction do not overwrite each other's history.
   */
  private async withLease(
    transId: string,
    work: (trans: Trans<any>) => Promise<ILeaseOutcome>,
  ): Promise<ITransRefundResult> {
    let stored = await this.repository.getById(transId);
    if (!stored)
      throw new NotFoundException('Transaction not found: ' + transId);

    let lockId: string | null = null;
    if (typeof this.repository.compareAndSet === 'function') {
      const until = stored.refreshLockUntil
        ? new Date(stored.refreshLockUntil).getTime()
        : 0;
      if (stored.refreshLockId && until > Date.now())
        throw new DomainValidationError('Transaction is busy, try again');
      lockId = randomUUID();
      const won = await this.repository.compareAndSet(
        stored.id,
        { status: stored.status, refreshLockId: stored.refreshLockId ?? null },
        {
          refreshLockId: lockId,
          refreshLockUntil: new Date(Date.now() + this.refundLeaseMs),
        },
        null,
      );
      if (!won)
        throw new DomainValidationError('Transaction is busy, try again');
      // Re-read under the lease: entries added before it are kept.
      stored = await this.repository.getById(transId);
      if (!stored)
        throw new NotFoundException('Transaction not found: ' + transId);
    }

    const trans = { ...stored, history: [...(stored.history ?? [])] };
    let outcome: ILeaseOutcome;
    try {
      outcome = await work(trans);
    } catch (err) {
      await this.release(stored.id, lockId);
      throw err;
    }
    if (outcome.changed) {
      if (lockId === null)
        await this.repository.updatePartial(
          {
            id: trans.id,
            modifyDate: trans.modifyDate,
            history: trans.history,
          },
          null,
        );
      else
        await this.repository.compareAndSet?.(
          trans.id,
          { refreshLockId: lockId },
          {
            modifyDate: trans.modifyDate,
            history: trans.history,
            refreshLockId: null,
            refreshLockUntil: null,
          },
          null,
        );
    } else await this.release(stored.id, lockId);
    if (outcome.error !== undefined) throw outcome.error;
    return outcome.result as ITransRefundResult;
  }

  private async release(id: string, lockId: string | null): Promise<void> {
    if (lockId === null) return;
    try {
      await this.repository.compareAndSet?.(
        id,
        { refreshLockId: lockId },
        { refreshLockId: null, refreshLockUntil: null },
        null,
      );
    } catch {
      // The lease expires on its own.
    }
  }
}
