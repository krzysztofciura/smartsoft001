import { HttpService } from '@nestjs/axios';
import { Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { firstValueFrom } from 'rxjs';

import {
  DomainValidationError,
  IItemRepository,
} from '@smartsoft001/domain-core';
import { PaynowService } from '@smartsoft001/paynow';
import { PaypalService } from '@smartsoft001/paypal';
import { PayuService } from '@smartsoft001/payu';
import { RevolutService } from '@smartsoft001/revolut';
import {
  ITransCreate,
  Trans,
  TransConfig,
  CreatorService,
  RefresherService,
  ITransPaymentSingleService,
  ITransInternalService,
  ITransRefundRequest,
  ITransRefundResult,
  RefundService,
} from '@smartsoft001/trans-domain';

import { TRANS_TOKEN_INTERNAL_SERVICE } from '../internal/internal.service';

@Injectable()
export class TransService {
  private get _paymentService(): {
    [key: string]: ITransPaymentSingleService;
  } {
    return {
      payu: this.payuService,
      paypal: this.paypalService,
      paynow: this.paynowService,
      revolut: this.revolutService,
    };
  }

  private _internalService: ITransInternalService<any> = {
    // Offline (no internalApiUrl) or without a declared idempotent API there
    // is nothing that can fulfil an order exactly once, so refuse. Async, so
    // the refusal is a rejected promise like every other failure.
    refreshOnce: async (trans: Trans<any>, idempotencyKey: string) => {
      if (
        !this.config.internalApiUrl ||
        this.config.idempotentInternalApi !== true
      ) {
        throw new DomainValidationError(
          'An idempotent internal API must be configured',
        );
      }
      return firstValueFrom(
        this.httpService.put(
          this.config.internalApiUrl + '/' + encodeURIComponent(trans.id),
          trans,
          { headers: { 'Idempotency-Key': idempotencyKey } },
        ),
      ).then((res) => res.data);
    },
    create: (trans: Trans<any>) => {
      // Only a back end can price an order. Without one there is no amount
      // to charge, so a payment cannot start.
      if (!this.config.internalApiUrl)
        return Promise.reject(
          new DomainValidationError(
            'No internal service approves the payment amount: set internalApiUrl or provide TRANS_TOKEN_INTERNAL_SERVICE',
          ),
        );

      return firstValueFrom(
        this.httpService.post(this.config.internalApiUrl, trans),
      ).then((res) => res.data);
    },
  };

  constructor(
    private moduleRef: ModuleRef,
    private creatorService: CreatorService<any>,
    private refresherService: RefresherService<any>,
    private refundService: RefundService<any>,
    private httpService: HttpService,
    private config: TransConfig,
    private repository: IItemRepository<Trans<any>>,
    @Optional() private payuService: PayuService,
    @Optional() private paynowService: PaynowService,
    @Optional() private paypalService: PaypalService,
    @Optional() private revolutService: RevolutService,
  ) {}

  create<T>(
    ops: ITransCreate<T>,
  ): Promise<{ orderId: string; redirectUrl?: string; responseData?: any }> {
    return this.creatorService.create(
      ops,
      this.getInternalService(),
      this._paymentService,
    );
  }

  async refresh(transId: string, data = {}): Promise<void> {
    await this.refresherService.refresh(
      transId,
      this.getInternalService(),
      this._paymentService,
      data,
    );
  }

  async refund(transId: string, comment = 'Refund'): Promise<void> {
    await this.refundService.refund(
      transId,
      this.getInternalService(),
      this._paymentService,
      comment,
    );
  }

  /** Partial, idempotent refund (see `RefundService.refundAmount`). */
  refundAmount(
    transId: string,
    request: ITransRefundRequest,
  ): Promise<ITransRefundResult> {
    return this.refundService.refundAmount(
      transId,
      this._paymentService,
      request,
    );
  }

  /** State of the refund with this key (see `RefundService.refundStatus`). */
  refundStatus(transId: string, key: string): Promise<ITransRefundResult> {
    return this.refundService.refundStatus(transId, this._paymentService, key);
  }

  /** `null` when no transaction has that id; the caller decides what that means. */
  async getById(id: any): Promise<Trans<any> | null> {
    return await this.repository.getById(id);
  }

  private getInternalService(): ITransInternalService<any> {
    try {
      return this.moduleRef.get(TRANS_TOKEN_INTERNAL_SERVICE, {
        strict: false,
      });
    } catch (e) {
      return this._internalService;
    }
  }
}
