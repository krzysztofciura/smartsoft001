# 📦 @smartsoft001/trans-shell-nestjs

![npm](https://img.shields.io/npm/v/@smartsoft001/trans-shell-nestjs) ![downloads](https://img.shields.io/npm/dm/@smartsoft001/trans-shell-nestjs)

## 🚀 Usage

`npm i @smartsoft001/trans-shell-nestjs`

## 🛠️ Modules

### TransShellNestjsModule
- Provides the main integration module for transaction features in a NestJS app.
- Static method: `forRoot(config)` — Registers controllers, providers, and imports required modules with the given configuration.

### TransShellNestjsCoreModule
- Provides a core integration module for transaction features in a NestJS app.
- Static method: `forRoot(config)` — Registers providers and imports required modules with the given configuration.

## 🗄️ Storage

Transactions are stored through the CRUD module: `db` keeps them in the `trans` collection of MongoDB (the default, unchanged), `persistence` in any storage module that provides the `domain-core` repositories, e.g. `SupabaseModule.forRoot({ table: 'trans', ... })` from `@smartsoft001/supabase`.

## 🛠️ Controllers & Methods

### TransController
<table>
    <tr>
        <td>POST /</td>
        <td>create — Creates a new transaction. Returns a redirect URL and orderId.</td>
    </tr>
    <tr>
        <td>POST /:id/refresh</td>
        <td>refresh — Refreshes the status of a transaction by orderId.</td>
    </tr>
</table>

### PayUController
<table>
    <tr>
        <td>POST /payu</td>
        <td>refreshStatus — Refreshes the status of a PayU transaction by orderId.</td>
    </tr>
</table>

### PaypalController
<table>
    <tr>
        <td>POST /paypal</td>
        <td>refreshStatus — Refreshes the status of a Paypal transaction by item_number1.</td>
    </tr>
    <tr>
        <td>GET /paypal/:id/confirm</td>
        <td>confirm — Confirms a Paypal payment and redirects to the appropriate URL.</td>
    </tr>
</table>

### PaynowController
<table>
    <tr>
        <td>POST /paynow</td>
        <td>refreshStatus — Refreshes the status of a Paynow transaction by paymentId.</td>
    </tr>
</table>
