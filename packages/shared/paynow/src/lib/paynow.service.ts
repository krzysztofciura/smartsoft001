import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import * as CryptoJS from 'crypto-js';
import { firstValueFrom } from 'rxjs';

import {
  ITransPaymentSingleService,
  ITransRefundRequest,
  ITransRefundResult,
  Trans,
  TransStatus,
} from '@smartsoft001/trans-domain';
import { GuidService } from '@smartsoft001/utils';

import { createHash } from 'crypto';

import {
  IPaynowConfigProvider,
  PAYNOW_CONFIG_PROVIDER,
  PaynowConfig,
} from './paynow.config';

function httpStatusOf(e: unknown): number | undefined {
  if (
    typeof e === 'object' &&
    e !== null &&
    'response' in e &&
    typeof e.response === 'object' &&
    e.response !== null &&
    'status' in e.response &&
    typeof e.response.status === 'number'
  ) {
    return e.response.status;
  }

  return undefined;
}

/**
 * HTTP errors retain the request, and every Paynow request carries the
 * `Api-Key` header. Neither the raw error nor its message may reach a log or
 * an upstream handler, so only the operation and the HTTP status survive.
 */
function paynowFailure(operation: string, e: unknown): Error {
  const status = httpStatusOf(e);
  const message =
    status === undefined
      ? `Paynow ${operation} failed`
      : `Paynow ${operation} failed (HTTP ${status})`;

  Logger.error(message, PaynowService.name);

  return new Error(message);
}

@Injectable()
export class PaynowService implements ITransPaymentSingleService {
  constructor(
    private readonly httpService: HttpService,
    private config: PaynowConfig,
    private moduleRef: ModuleRef,
  ) {}

  async create(obj: {
    id: string;
    name: string;
    amount: number;
    firstName?: string;
    lastName?: string;
    email?: string;
    contactPhone?: string;
    clientIp: string;
    data: any;
    options?: any;
  }): Promise<{ orderId: string; redirectUrl: string }> {
    const config = await this.getConfig(obj.data);

    const data = {
      externalId: obj.id,
      description: obj.name,
      currency: 'PLN',
      amount: obj.amount,
      continueUrl: config.continueUrl,
      buyer: {
        email: obj.email,
      } as any,
    };

    if (obj.contactPhone || obj.firstName || obj.lastName) {
      data['buyer'] = {
        email: obj.email,
        phone: obj.contactPhone,
        firstName: obj.firstName,
        lastName: obj.lastName,
      };
    }

    const signature = this.getSignature(data, config);

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.post(this.getBaseUrl(config) + '/v1/payments', data, {
          headers: {
            'Content-Type': 'application/json',
            'Api-Key': config.apiKey,
            'Idempotency-Key': GuidService.create(),
            Signature: signature,
          },
          maxRedirects: 0,
        }),
      );
    } catch (e) {
      throw paynowFailure('payment creation', e);
    }

    return {
      redirectUrl: response.data.redirectUrl,
      orderId: response.data.paymentId,
    };
  }

  async getStatus<T>(
    trans: Trans<T>,
  ): Promise<{ status: TransStatus; data: any }> {
    const orderId = this.getOrderId(trans);
    const config = await this.getConfig(trans.data);

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.get(
          this.getBaseUrl(config) + '/v1/payments/' + orderId + '/status',
          {
            headers: {
              'Content-Type': 'application/json',
              'Api-Key': config.apiKey,
            },
          },
        ),
      );
    } catch (e) {
      throw paynowFailure('status lookup', e);
    }

    return {
      status: this.getStatusFromExternal(response.data.status),
      data: response.data,
    };
  }

  async refund(trans: Trans<any>, comment: string): Promise<any> {
    const orderId = this.getOrderId(trans);
    const config = await this.getConfig(trans.data);

    const data = {
      amount: trans.amount,
    };

    const signature = this.getSignature(data, config);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.getBaseUrl(config) + '/v1/payments/' + orderId + '/refunds',
          data,
          {
            headers: {
              'Content-Type': 'application/json',
              'Api-Key': config.apiKey,
              'Idempotency-Key': GuidService.create(),
              Signature: signature,
            },
          },
        ),
      );

      return response.data;
    } catch (e) {
      throw paynowFailure('refund', e);
    }
  }

  /**
   * Partial refund. The refund key becomes the `Idempotency-Key` (at most 45
   * characters; longer keys are hashed), so a retry never refunds twice.
   */
  async refundAmount(
    trans: Trans<any>,
    refund: ITransRefundRequest,
  ): Promise<ITransRefundResult> {
    const orderId = this.getOrderId(trans);
    const config = await this.getConfig(trans.data);
    const data = {
      amount: refund.amount,
      ...(refund.comment ? { description: refund.comment.slice(0, 255) } : {}),
    };
    const key =
      refund.key.length <= 45
        ? refund.key
        : createHash('sha256').update(refund.key).digest('hex').slice(0, 45);

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.post(
          this.getBaseUrl(config) +
            '/v1/payments/' +
            encodeURIComponent(orderId) +
            '/refunds',
          data,
          {
            headers: {
              'Content-Type': 'application/json',
              'Api-Key': config.apiKey,
              'Idempotency-Key': key,
              Signature: this.getSignature(data, config),
            },
            maxRedirects: 0,
          },
        ),
      );
    } catch (e) {
      throw paynowFailure('refund', e);
    }

    return this.refundResult(response.data);
  }

  async refundStatus(
    trans: Trans<any>,
    refundId: string,
  ): Promise<ITransRefundResult> {
    const config = await this.getConfig(trans.data);

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.get(
          this.getBaseUrl(config) +
            '/v1/refunds/' +
            encodeURIComponent(refundId) +
            '/status',
          {
            headers: { 'Api-Key': config.apiKey },
            maxRedirects: 0,
          },
        ),
      );
    } catch (e) {
      throw paynowFailure('refund status lookup', e);
    }

    return this.refundResult(response.data);
  }

  /** Paynow refund states: NEW and PENDING until settled, then SUCCESSFUL, FAILED or CANCELLED. */
  private refundResult(refund: any): ITransRefundResult {
    if (typeof refund?.refundId !== 'string' || !refund.refundId)
      throw new Error('Paynow refund answer without a refund id');
    const status =
      refund.status === 'SUCCESSFUL'
        ? 'succeeded'
        : refund.status === 'FAILED' || refund.status === 'CANCELLED'
          ? 'failed'
          : 'pending';
    return { refundId: refund.refundId, status };
  }

  private getOrderId(trans: Trans<any>): string {
    const historyItem = trans.history.find((x) => x.status === 'started');

    // Without the `started` entry there is no Paynow payment to address: the
    // request would go to `/v1/payments/null/...`, which Paynow rejects anyway.
    if (!historyItem) {
      throw new Error('Transaction without start status');
    }

    return historyItem.data.orderId;
  }

  private async getConfig(data: any): Promise<PaynowConfig> {
    let provider: IPaynowConfigProvider | undefined;
    try {
      provider = this.moduleRef.get(PAYNOW_CONFIG_PROVIDER, { strict: false });
    } catch {
      provider = undefined;
    }
    if (!provider) {
      Logger.warn('Paynow config provider not found', PaynowService.name);
      return this.config;
    }

    // A provider that fails (settings missing or unreadable) stops the call:
    // falling back to the static configuration could use other credentials.
    return provider.get(data);
  }

  private getBaseUrl(config: PaynowConfig): string {
    if (config.test) return 'https://api.sandbox.paynow.pl';

    return 'https://api.paynow.pl';
  }

  private getStatusFromExternal(status: string): any {
    switch (status) {
      case 'CONFIRMED':
        return 'completed';
      case 'REJECTED':
      case 'ERROR':
      case 'EXPIRED':
      case 'ABANDONED':
        return 'canceled';
      case 'NEW':
      case 'PENDING':
        return 'pending';
      default:
        return status;
    }
  }

  private getSignature(data: any, config: PaynowConfig): string {
    return CryptoJS.enc.Base64.stringify(
      CryptoJS.HmacSHA256(JSON.stringify(data), config.apiSignatureKey),
    );
  }
}
