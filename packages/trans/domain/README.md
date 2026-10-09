# 📦 @smartsoft001/trans-domain

![npm](https://img.shields.io/npm/v/@smartsoft001/trans-domain) ![downloads](https://img.shields.io/npm/dm/@smartsoft001/trans-domain)

## 🚀 Usage

`npm i @smartsoft001/trans-domain`

## 🛠️ Services & Methods

### CreatorService

Methods:

<table>
    <tr>
        <td>create</td>
        <td>Creates a new transaction, prepares it, sets it as new, and starts the payment process. Returns orderId, redirectUrl, and responseData.</td>
    </tr>
</table>

### RefresherService

Methods:

<table>
    <tr>
        <td>refresh</td>
        <td>Refreshes the status of a transaction by querying the payment service and updating the transaction accordingly.</td>
    </tr>
</table>

### RefundService

Methods:

<table>
    <tr>
        <td>refund</td>
        <td>Processes a refund for a completed transaction and updates its status and history.</td>
    </tr>
    <tr>
        <td>refundAmount</td>
        <td>Returns part or all of a completed payment, idempotently per refund key.</td>
    </tr>
    <tr>
        <td>refundStatus</td>
        <td>Reads the provider's state of a refund started with <code>refundAmount</code>.</td>
    </tr>
</table>

#### Partial and repeated refunds

`refundAmount(transId, paymentService, { amount, key, comment })` needs a payment service with
`refundAmount` (PayU and Paynow have it). `amount` is a positive integer in the smallest unit and
at most what is left after earlier refunds that did not fail; `key` (`[A-Za-z0-9_-]{1,64}`)
identifies the refund at the provider, so retrying a lost answer with the same key never pays twice.
A repeated key with a recorded answer is answered from the history without calling the provider.

Each refund is a history entry with the status `refund` and `data.refund` =
`{ key, amount, refundId, status }` (`pending`, `succeeded`, `failed`, or `unknown` when the
provider call failed; the error is stored in its safe form). The transaction itself keeps the status
`completed`, which is what the provider keeps reporting for the payment, so a later status refresh
does not undo the refunds. `refundStatus(transId, paymentService, key)` asks the provider about a
pending refund and records the change.

Both hold the refresh lease while they work (when the repository has `compareAndSet`) and re-read
the transaction under it, so refunds and refreshes of one transaction do not overwrite each other.

### TransConfig

Constructor:

<table>
    <tr>
        <td>constructor</td>
        <td>Initializes configuration with internalApiUrl and tokenConfig (secretOrPrivateKey, expiredIn).</td>
    </tr>
</table>


## 💰 Payment amounts

The amount the payment provider charges comes from your server, never from the client.
`ITransInternalService.create` must resolve `{ amount }`, computed from trusted order data: a
positive safe integer in the provider's smallest currency unit (grosze for PLN, so `14999` for
149.99 PLN). Missing, zero, fractional, non-finite, string or unsafe integer values are rejected
with `DomainValidationError` before the provider is called. The client's `amount` is never a
fallback. It stays in `ITransCreate` and must still be at least `1`, only for compatibility.

Check customer and order access, stock, currency, discounts, tax and shipping in that service, and
never echo the request amount back. Compare the settled payment with the order before fulfilment.
This package does not calculate prices or authenticate the checkout.

### Upgrading

- Return `{ amount }` from `ITransInternalService.create`. The return type is now
  `Promise<ITransInternalCreateResult>`, so TypeScript flags implementations that don't.
- With the built-in HTTP internal service, the response of `POST internalApiUrl` must contain
  `amount`.
- With an empty `internalApiUrl` and no `TRANS_TOKEN_INTERNAL_SERVICE` provider, payments can no
  longer be created. Register an internal service first, also in development.
- `error` history entries now hold `{ name, message, status? }` (`ITransErrorEvent`) instead of the
  raw error, so credentials in provider errors are never stored.

## 🔁 Idempotent fulfilment

`RefresherService` applies the business effect of a status change through
`ITransInternalService.refreshOnce(trans, idempotencyKey)` and never falls back to `refresh`. Your
handler must deduplicate the effect atomically in durable storage by that key and resolve the same
receipt when the key is replayed: write the effect and a unique-key row in one database transaction,
or use an outbox. A rename without deduplication, a mutex in one Node process or marking the order
paid before fulfilment does not meet the contract. External effects need idempotency at their own
boundary.

The key is derived from the transaction id, the provider, the provider's order id and the target
status, so every instance and every retry uses the same key, including a retry after fulfilment
succeeded but the status write failed. A failure keeps the previous persisted status so a retry can
recover. The provider is always asked for the actual status; notification content is not trusted.
The library cannot make arbitrary external effects exactly-once: test with independent processes,
database transactions, crashes and replayed receipts.

### Upgrading

- Implement `refreshOnce`. It is now required by `ITransInternalService`, so TypeScript flags
  services without it; at runtime they are refused before any effect runs.
- `refresh` is optional and `@deprecated`. Nothing calls it, refunds included, so move its logic to
  `refreshOnce`.
- With the built-in HTTP internal service, make `PUT {internalApiUrl}/{id}` honour the
  `Idempotency-Key` header, then set `TransConfig.idempotentInternalApi = true`. Without the flag
  every status change is refused; the flag alone provides no deduplication.
- With an empty `internalApiUrl` and no `TRANS_TOKEN_INTERNAL_SERVICE` provider (offline/dev mode),
  nothing can fulfil an order, so status changes are refused as well (creating a payment already
  rejects there, see Payment amounts above).
- A failed refresh no longer stores status `error`; the record keeps its last persisted status.
  Failed creates and refunds still record `error` with an `ITransErrorEvent`.

## 🔒 Concurrent refreshes

Two instances can read the same `started` transaction at once (a PayU notification and a manual
`POST /:id/refresh`, for example). With a repository that implements the optional
`IItemRepository.compareAndSet`, which `MongoItemRepository` does, `RefresherService` refreshes in
three steps:

1. **Claim**: compare-and-set a lease (`refreshLockId`, `refreshLockUntil`) where `status` still
   equals the value read and no other instance holds a live lease. Matching nothing means another
   instance won or is working on it, so the refresh returns without calling `refreshOnce`.
2. **Fulfil**: `refreshOnce` runs while the stored status is still the old one. A failure or a
   falsy answer drops the lease and keeps the status, so a retry runs again with the same key. A
   crash leaves the lease until it expires (two minutes, the protected `refreshLeaseMs`).
3. **Commit**: compare-and-set the new status and history where `status` is still the old one and
   the lease is still ours. If the lease expired and another instance took over, the write is
   dropped quietly; that instance persists the status, and the idempotency key deduplicates the
   fulfilment.

This is defence in depth on top of the idempotency key, not a replacement.

### Upgrading

- With `MongoItemRepository`, nothing to change.
- A custom `IItemRepository` without `compareAndSet` still compiles and falls back to
  `updatePartial`, the unconditional write of earlier versions. Implement `compareAndSet` (atomic,
  equality only, `null` matching a missing field, resolving whether a record matched) to get the
  protection.
- `Trans` gains `refreshLockId` and `refreshLockUntil`. They are internal; do not write them.
- A refresh that meets a live lease or loses the claim resolves without effect. A crashed instance
  blocks refreshes of that transaction until its lease expires.
