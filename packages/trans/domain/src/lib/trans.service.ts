import {
  DomainValidationError,
  IItemRepository,
} from '@smartsoft001/domain-core';
import { ObjectService } from '@smartsoft001/utils';

import { Trans, TransHistory, TransStatus } from './entities/trans.entity';

/**
 * What `setError` stores as the history payload of a failed step. Errors can
 * carry request credentials (headers, bodies, messages), functions and
 * circular sockets, so only these three fields are ever kept.
 */
export interface ITransErrorEvent {
  name: string;
  message: string;
  status?: number;
}

/** @deprecated Use {@link ITransErrorEvent}; interfaces start with `I`. */
export type TransErrorEvent = ITransErrorEvent;

function errorName(error: unknown): string {
  if (error instanceof DomainValidationError) return 'DomainValidationError';
  if (!(error instanceof Error)) return 'Error';
  if (error.name && error.name !== 'Error') return error.name;

  return error.constructor?.name || 'Error';
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const candidate = error as {
    response?: { status?: unknown };
    getStatus?: unknown;
  };

  if (typeof candidate.response?.status === 'number') {
    return candidate.response.status;
  }

  if (typeof candidate.getStatus === 'function') {
    const status = candidate.getStatus();
    if (typeof status === 'number') return status;
  }

  return undefined;
}

function toTransErrorEvent(
  error: unknown,
  context = 'Transaction failed',
): ITransErrorEvent {
  const name = errorName(error);

  if (error instanceof DomainValidationError) {
    return { name, message: error.message };
  }

  const status = httpStatus(error);

  if (status !== undefined) {
    return { name, message: `${context} (HTTP ${status})`, status };
  }

  return { name, message: context };
}

export abstract class TransBaseService<T> {
  protected constructor(protected repository: IItemRepository<Trans<T>>) {}

  /** Appends a history entry; `status` defaults to the transaction's current status. */
  protected addHistory(
    trans: Trans<T>,
    data: any,
    status: TransStatus = trans.status,
  ): void {
    const historyItem = new TransHistory<T>();
    historyItem.amount = trans.amount;
    historyItem.modifyDate = trans.modifyDate;
    historyItem.data = ObjectService.removeTypes(data);
    historyItem.system = trans.system;
    historyItem.status = status;
    if (!trans.history) trans.history = [];
    trans.history.push(historyItem);
  }

  /** The safe form of an error for the history: name, a safe message and the HTTP status. */
  protected errorEvent(error: unknown, context?: string): ITransErrorEvent {
    return toTransErrorEvent(error, context);
  }

  /**
   * Marks the transaction as failed and persists it. The error itself is never
   * stored: only its name, a safe message and the HTTP status, if any.
   */
  protected async setError(
    trans: Trans<T>,
    error: unknown,
    context?: string,
  ): Promise<void> {
    trans.modifyDate = new Date();
    trans.status = 'error';
    this.addHistory(trans, toTransErrorEvent(error, context));

    await this.repository.update(trans as any, null);
  }
}
