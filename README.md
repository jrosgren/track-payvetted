# payvetted-check

A small, read-only TypeScript CLI that inspects a public [x402](https://x402.org) endpoint before an agent pays.

It does not send a payment, hold keys, or call paid services. Given a URL it:

1. Fetches the endpoint and reads the HTTP 402 payment requirements (`payTo`, `amount`, `asset`, `network`). Both the x402 v2 `PAYMENT-REQUIRED` header and the older JSON body form are accepted.
2. Reports endpoint health and latency.
3. Compares the advertised terms to a listing you provide, if any (payout address, price, asset, network).
4. Looks up the `payTo` address on Base through a public RPC: contract vs EOA, nonce, native and token balances, and age when a public explorer is reachable and has a first transaction.
5. Prints `allow`, `warn` or `deny` with reasons.

This is a local example of the checks Payvetted runs for pay-safe decisions. For automated checks, contact ella@jabbconsulting.com.

## Requirements

- Node.js 20 or later

## Install and run

```bash
git clone https://github.com/jrosgren/track-payvetted.git
cd track-payvetted
npm install
npm run build
node dist/index.js https://example-x402-endpoint.example/path
```

Or after a local install:

```bash
npm link
payvetted-check https://example-x402-endpoint.example/path
```

### Options

```text
payvetted-check <url> [--method GET|POST] [--header "Name: value"]
                  [--body <json|@file>] [--listing <json|@file>]
                  [--rpc <url>] [--timeout-ms 10000] [--json]
```

`--listing` is a JSON object with any of `payTo`, `amount`, `asset`, and `network`. Amounts are atomic token units (for USDC, `10000` is 0.01 USDC).

```bash
payvetted-check https://api.example.com/resource \
  --listing '{"payTo":"0xabc...","amount":"10000","asset":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","network":"eip155:8453"}' \
  --json
```

Exit codes: `0` allow, `1` warn, `2` deny, `3` usage or runtime error.

## Verdict rules

A `deny` reason always wins over `warn`, and `warn` wins over `allow`.

**Deny** when the endpoint is unreachable, the 402 cannot be parsed, `payTo` / `amount` / `asset` / `network` is missing or invalid, the amount is zero, or a provided listing disagrees on payout address, asset, network, or a higher price than listed.

**Warn** when latency is over 2 seconds, the network is not Base mainnet, the asset is not a known USD-pegged token, `payTo` is a contract, the EOA has nonce 0, the address is less than 7 days old, the advertised price is lower than the listing, or the wallet lookup fails.

**Allow** when the endpoint returns a parseable 402, the terms are complete, Base mainnet and a known asset are used, the payout address looks consistent, and any listing you supplied matches.

These rules are conservative and local. They are not a credit rating, sanctions screen, or guarantee that a payment will settle or that the resource will be delivered.

## What it does not do

- It never attaches a `PAYMENT-SIGNATURE` or otherwise pays.
- It uses only public HTTPS, public Base RPCs (`mainnet.base.org` and fallbacks), and public Blockscout explorers for address age.
- It does not depend on AWS or other hosted infrastructure of its own.

## License

MIT. See [LICENSE](LICENSE).
