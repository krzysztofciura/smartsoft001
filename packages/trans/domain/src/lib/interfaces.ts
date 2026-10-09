import { Trans, TransStatus } from './entities';

/**
 * The answer of `ITransInternalService.create`. It is stored as the history
 * payload of the `new` step, so extra fields are welcome.
 */
export interface ITransInternalCreateResult {
  /**
   * The price the payment provider is asked to charge, computed on the server
   * from trusted order data: a positive safe integer in the provider's
   * smallest currency unit (grosze for PLN). The amount sent by the client is
   * never used.
   */
  amount: number;
  [key: string]: unknown;
}

export interface ITransInternalService<T> {
  create(trans: Trans<T>): Promise<ITransInternalCreateResult>;

  /**
   * @deprecated Never called: `RefresherService` uses `refreshOnce`, and
   * `RefundService` calls no internal method. Move its logic to `refreshOnce`.
   */
  refresh?(trans: Trans<any>): Promise<any>;

  /**
   * Applies the business effect of a status change (fulfil, cancel) exactly
   * once per `idempotencyKey`: deduplicate atomically in durable storage and
   * resolve the same receipt when the key is replayed. A falsy answer leaves
   * the status change unsaved.
   */
  refreshOnce(trans: Trans<any>, idempotencyKey: string): Promise<any>;
}

export interface ITransPaymentService {
  [key: string]: ITransPaymentSingleService;
}

export interface ITransPaymentSingleService {
  create(obj: {
    id: string;
    name: string;
    amount: number;
    firstName?: string;
    lastName?: string;
    email?: string;
    contactPhone?: string;
    clientIp: string;
    data: any;
    options: any;
  }): Promise<{ orderId: string; redirectUrl?: string; responseData?: any }>;

  getStatus<T>(trans: Trans<T>): Promise<{ status: TransStatus; data: any }>;

  refund(trans: Trans<any>, comment: string): Promise<any>;

  /**
   * Returns `amount` of a completed payment. `key` identifies this refund at
   * the provider (its external refund id or idempotency key), so a retry
   * after a lost answer never refunds twice.
   */
  refundAmount?(
    trans: Trans<any>,
    refund: ITransRefundRequest,
  ): Promise<ITransRefundResult>;

  /** Current state of a refund started with `refundAmount`. */
  refundStatus?(
    trans: Trans<any>,
    refundId: string,
  ): Promise<ITransRefundResult>;
}

export interface ITransRefundRequest {
  /** Positive safe integer in the smallest currency unit, at most what is left to refund. */
  amount: number;
  /** 1–64 characters `[A-Za-z0-9_-]`, unique per refund. */
  key: string;
  comment: string;
}

/**
 * A refund as the provider reports it: `pending` until the provider settles
 * it, then `succeeded` or `failed`. `refundId` is the provider's id.
 */
export interface ITransRefundResult {
  refundId: string;
  status: 'pending' | 'succeeded' | 'failed';
  data?: unknown;
}
