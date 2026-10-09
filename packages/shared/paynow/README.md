# 📦 @smartsoft001/paynow

![npm](https://img.shields.io/npm/v/@smartsoft001/paynow) ![downloads](https://img.shields.io/npm/dm/@smartsoft001/paynow)

## 🚀 Usage

`npm i @smartsoft001/paynow`

## 🛠️ Services & Methods

### PaynowService

Methods:

<table>
    <tr>
        <td>create</td>
        <td>Initiates a new payment request with an external payment provider</td>
    </tr>
    <tr>
        <td>getStatus</td>
        <td>Retrieves the current status of a previously created payment</td>
    </tr>
    <tr>
        <td>refund</td>
        <td>Issues a refund for an existing payment</td>
    </tr>
    <tr>
        <td>refundAmount</td>
        <td>Refunds an amount; the refund key is the <code>Idempotency-Key</code> (hashed above 45 characters)</td>
    </tr>
    <tr>
        <td>refundStatus</td>
        <td>Reads a refund: <code>SUCCESSFUL</code> → succeeded, <code>FAILED</code>/<code>CANCELLED</code> → failed, otherwise pending</td>
    </tr>
</table>

Payment states `NEW` and `PENDING` are reported as `pending`; `REJECTED`, `ERROR`, `EXPIRED`
and `ABANDONED` as `canceled`.

When a `PAYNOW_CONFIG_PROVIDER` is registered and fails, the call fails too: the static
`PaynowConfig` is used only when no provider is registered.

## ⚠️ Errors

A failed Paynow call is never rethrown as the raw axios error, because that error carries the
`Api-Key` header. `create`, `getStatus` and `refund` log one line through the NestJS `Logger` and
throw a plain `Error` with no `cause`, `config` or `response`:

- `Paynow payment creation failed (HTTP {status})`
- `Paynow status lookup failed (HTTP {status})`
- `Paynow refund failed (HTTP {status})`
- `Paynow refund status lookup failed (HTTP {status})`

The ` (HTTP {status})` suffix is present only when Paynow answered, so `401` and `5xx` stay
distinguishable.

Migration: code that read `e.response` from these errors must read the message instead. The
`error` history entries written by `setError` for these failures no longer carry a `status`.
