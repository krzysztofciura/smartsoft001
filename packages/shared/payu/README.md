# 📦 @smartsoft001/payu

![npm](https://img.shields.io/npm/v/@smartsoft001/payu) ![downloads](https://img.shields.io/npm/dm/@smartsoft001/payu)

## 🚀 Usage

`npm i @smartsoft001/payu`

## 🛠️ Services & Methods

### PayuService

Methods:

<table>
    <tr>
        <td>create</td>
        <td>Initiates a new payment order with an external payment API</td>
    </tr>
    <tr>
        <td>getStatus</td>
        <td>Retrieves the current status of an existing payment order</td>
    </tr>
    <tr>
        <td>refund</td>
        <td>Issues a refund for an existing payment order</td>
    </tr>
    <tr>
        <td>refundAmount</td>
        <td>Refunds an amount, with the refund key as <code>extRefundId</code></td>
    </tr>
    <tr>
        <td>refundStatus</td>
        <td>Reads a refund: <code>PENDING</code> → pending, <code>FINALIZED</code> → succeeded, <code>CANCELED</code> → failed</td>
    </tr>
</table>

Payment states `NEW`, `PENDING` and `WAITING_FOR_CONFIRMATION` are reported as `pending`. Enable
automatic receipt in the PayU shop, otherwise payments wait for a manual confirmation there.

When a `PAYU_CONFIG_PROVIDER` is registered and fails, the call fails too: the static `PayuConfig`
is used only when no provider is registered.

## ⚠️ Errors

A failed PayU call is never rethrown as the raw axios error, because that error carries the OAuth
client secret or the `Authorization: Bearer` token. Each method logs one line through the NestJS
`Logger` and throws a plain `Error` with no `cause`, `config` or `response`:

- `PayU authentication failed (HTTP {status})`
- `PayU order creation failed (HTTP {status})`
- `PayU status lookup failed (HTTP {status})`
- `PayU refund failed (HTTP {status})`
- `PayU refund status lookup failed (HTTP {status})`

The ` (HTTP {status})` suffix is present only when PayU answered, so `401` and `5xx` stay
distinguishable. Code that read `e.response` from these errors must read the message instead.
