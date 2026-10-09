import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { firstValueFrom } from 'rxjs';

import {
  ITransPaymentSingleService,
  ITransRefundRequest,
  ITransRefundResult,
  Trans,
  TransStatus,
} from '@smartsoft001/trans-domain';

import {
  IPayuConfigProvider,
  PAYU_CONFIG_PROVIDER,
  PayuConfig,
} from './payu.config';

interface PayuOrderRequest {
  customerIp: string;
  extOrderId: string;
  merchantPosId: string;
  description: string;
  currencyCode: string;
  totalAmount: number;
  notifyUrl: string;
  continueUrl: string;
  products: Array<{ name: string; unitPrice: number; quantity: string }>;
  payMethods?: { payMethod: unknown };
  buyer?: {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
  };
}

/**
 * PayU answers a successful order with a 302 whose body carries the order;
 * axios surfaces that as an error with the response attached.
 */
function isRedirectResponse(
  e: unknown,
): e is { response: { status: number; data: any } } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'response' in e &&
    typeof e.response === 'object' &&
    e.response !== null
  );
}

function httpStatusOf(e: unknown): number | undefined {
  if (isRedirectResponse(e) && typeof e.response.status === 'number') {
    return e.response.status;
  }

  return undefined;
}

/**
 * HTTP errors retain the request: the OAuth body carries the client secret and
 * every other call carries `Authorization: Bearer <token>`. Neither the raw
 * error nor its message may reach a log or an upstream handler, so only the
 * operation and the HTTP status survive.
 */
function payuFailure(operation: string, e: unknown): Error {
  const status = httpStatusOf(e);
  const message =
    status === undefined
      ? `PayU ${operation} failed`
      : `PayU ${operation} failed (HTTP ${status})`;

  Logger.error(message, PayuService.name);

  return new Error(message);
}

@Injectable()
export class PayuService implements ITransPaymentSingleService {
  constructor(
    private readonly httpService: HttpService,
    private config: PayuConfig,
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
    const token = await this.getToken(config);

    const data: PayuOrderRequest = {
      customerIp: obj.clientIp,
      extOrderId: obj.id,
      merchantPosId: config.posId,
      description: obj.name,
      currencyCode: 'PLN',
      totalAmount: obj.amount,
      notifyUrl: config.notifyUrl,
      continueUrl: config.continueUrl,
      products: [
        {
          name: obj.name,
          unitPrice: obj.amount,
          quantity: '1',
        },
      ],
    };

    if (obj.options && obj.options['payMethod']) {
      data.payMethods = {
        payMethod: obj.options['payMethod'],
      };
    }

    if (obj.contactPhone || obj.email || obj.firstName || obj.lastName) {
      data.buyer = {
        email: obj.email,
        phone: obj.contactPhone,
        firstName: obj.firstName,
        lastName: obj.lastName,
      };
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.getBaseUrl(config) + '/api/v2_1/orders',
          data,
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + token,
              'X-Requested-With': 'XMLHttpRequest',
            },
            maxRedirects: 0,
          },
        ),
      );

      return {
        redirectUrl: response.data.redirectUri,
        orderId: response.data.orderId,
      };
    } catch (e) {
      if (isRedirectResponse(e) && e.response.status === 302) {
        return {
          redirectUrl: e.response.data.redirectUri,
          orderId: e.response.data.orderId,
        };
      }
      throw payuFailure('order creation', e);
    }
  }

  async getStatus<T>(
    trans: Trans<T>,
  ): Promise<{ status: TransStatus; data: any }> {
    const orderId = this.getOrderId(trans);
    const config = await this.getConfig(trans.data);

    const token = await this.getToken(config);

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.get(
          this.getBaseUrl(config) + '/api/v2_1/orders/' + orderId,
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + token,
              'X-Requested-With': 'XMLHttpRequest',
            },
            maxRedirects: 0,
          },
        ),
      );
    } catch (e) {
      throw payuFailure('status lookup', e);
    }

    // The refresher destructures `{ status, data }` from this result, so an
    // answer without orders cannot be reported as a status; say so instead.
    if (!response.data.orders) {
      throw new Error('PayU order not found: ' + orderId);
    }

    const order = response.data.orders[0];

    return {
      status: this.getStatusFromExternal(order.status),
      data: order,
    };
  }

  async refund(trans: Trans<any>, comment: string): Promise<any> {
    const orderId = this.getOrderId(trans);
    const config = await this.getConfig(trans.data);

    const token = await this.getToken(config);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.getBaseUrl(config) +
            '/api/v2_1/orders/' +
            encodeURIComponent(orderId) +
            '/refunds',
          {
            refund: {
              description: comment,
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + token,
              'X-Requested-With': 'XMLHttpRequest',
            },
            maxRedirects: 0,
          },
        ),
      );

      return response.data;
    } catch (e) {
      throw payuFailure('refund', e);
    }
  }

  /**
   * Partial refund. `extRefundId` is the refund key, so PayU refuses a second
   * refund with the same key instead of paying it out twice.
   */
  async refundAmount(
    trans: Trans<any>,
    refund: ITransRefundRequest,
  ): Promise<ITransRefundResult> {
    const orderId = this.getOrderId(trans);
    const config = await this.getConfig(trans.data);
    const token = await this.getToken(config);

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.post(
          this.getBaseUrl(config) +
            '/api/v2_1/orders/' +
            encodeURIComponent(orderId) +
            '/refunds',
          {
            refund: {
              description: refund.comment || 'Refund',
              amount: refund.amount,
              extRefundId: refund.key,
              currencyCode: 'PLN',
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + token,
            },
            maxRedirects: 0,
          },
        ),
      );
    } catch (e) {
      throw payuFailure('refund', e);
    }

    return this.refundResult(response.data?.refund);
  }

  async refundStatus(
    trans: Trans<any>,
    refundId: string,
  ): Promise<ITransRefundResult> {
    const orderId = this.getOrderId(trans);
    const config = await this.getConfig(trans.data);
    const token = await this.getToken(config);

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.get(
          this.getBaseUrl(config) +
            '/api/v2_1/orders/' +
            encodeURIComponent(orderId) +
            '/refunds/' +
            encodeURIComponent(refundId),
          {
            headers: { Authorization: 'Bearer ' + token },
            maxRedirects: 0,
          },
        ),
      );
    } catch (e) {
      throw payuFailure('refund status lookup', e);
    }

    return this.refundResult(response.data);
  }

  /** PayU refund states: PENDING until settled, then FINALIZED or CANCELED. */
  private refundResult(refund: any): ITransRefundResult {
    if (typeof refund?.refundId !== 'string' || !refund.refundId)
      throw new Error('PayU refund answer without a refund id');
    const status =
      refund.status === 'FINALIZED'
        ? 'succeeded'
        : refund.status === 'CANCELED'
          ? 'failed'
          : 'pending';
    return { refundId: refund.refundId, status };
  }

  private getOrderId(trans: Trans<any>): string {
    const historyItem = trans.history.find((x) => x.status === 'started');

    // Without the `started` entry there is no PayU order to address: the
    // request would go to `/api/v2_1/orders/null`, which PayU rejects anyway.
    if (!historyItem) {
      throw new Error('Transaction without start status');
    }

    return historyItem.data.orderId;
  }

  private async getToken(config: PayuConfig): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.getBaseUrl(config) + '/pl/standard/user/oauth/authorize',
          new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: config.clientId,
            client_secret: config.clientSecret,
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          },
        ),
      );

      return response.data['access_token'];
    } catch (e) {
      throw payuFailure('authentication', e);
    }
  }

  private async getConfig(data: any): Promise<PayuConfig> {
    let provider: IPayuConfigProvider | undefined;
    try {
      provider = this.moduleRef.get(PAYU_CONFIG_PROVIDER, { strict: false });
    } catch {
      provider = undefined;
    }
    if (!provider) {
      Logger.warn('PayU config provider not found', PayuService.name);
      return this.config;
    }

    // A provider that fails (settings missing or unreadable) stops the call:
    // falling back to the static configuration could use other credentials.
    return provider.get(data);
  }

  private getBaseUrl(config: PayuConfig): string {
    if (config.test) return 'https://secure.snd.payu.com';

    return 'https://secure.payu.com';
  }

  private getStatusFromExternal(status: string): any {
    switch (status) {
      case 'COMPLETED':
        return 'completed';
      case 'CANCELED':
        return 'canceled';
      case 'NEW':
      case 'PENDING':
      case 'WAITING_FOR_CONFIRMATION':
        return 'pending';
      default:
        return status;
    }
  }
}
