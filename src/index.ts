#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runCheck } from "./check.js";
import type { CheckOptions, CheckResult, ListingExpectation, Verdict } from "./types.js";

const USAGE = `Usage: payvetted-check <url> [options]

Read-only pre-payment check for a public x402 endpoint.
Fetches the 402 response, parses payment requirements, compares them
to an optional listing, and inspects the payTo address on Base via a
public RPC. Prints allow, warn or deny with reasons.

Options:
  --method GET|POST     HTTP method (default: GET)
  --header "Name: value" Extra request header (repeatable)
  --body <json|@file>   Request body for POST
  --listing <json|@file> Expected payTo, amount, asset, network
  --rpc <url>           Public RPC URL (repeatable; default is public Base RPCs)
  --timeout-ms <n>      Request timeout in milliseconds (default: 10000)
  --json                Print machine-readable JSON
  --help                Show this help

Exit codes: 0 allow, 1 warn, 2 deny, 3 usage or runtime error.

For automated checks, contact ella@jabbconsulting.com.
`;

function die(message: string, code = 3): never {
  console.error(message);
  process.exit(code);
}

function loadValue(raw: string): string {
  if (raw.startsWith("@")) {
    return readFileSync(raw.slice(1), "utf8");
  }
  return raw;
}

function parseListing(raw: string): ListingExpectation {
  const text = loadValue(raw).trim();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const listing: ListingExpectation = {};
  if (typeof parsed.payTo === "string") listing.payTo = parsed.payTo;
  if (typeof parsed.amount === "string" || typeof parsed.amount === "number") listing.amount = String(parsed.amount);
  if (typeof parsed.maxAmountRequired === "string") listing.amount = parsed.maxAmountRequired;
  if (typeof parsed.asset === "string") listing.asset = parsed.asset;
  if (typeof parsed.network === "string") listing.network = parsed.network;
  return listing;
}

function parseArgs(argv: string[]): { url: string; options: CheckOptions; json: boolean } {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    process.exit(argv.length === 0 ? 3 : 0);
  }
  const options: CheckOptions = { headers: {}, rpcUrls: [] };
  let json = false;
  let url: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) die(`Missing value for ${arg}`);
      return value;
    };
    if (arg === "--json") {
      json = true;
    } else if (arg === "--method") {
      options.method = next();
    } else if (arg === "--header") {
      const value = next();
      const idx = value.indexOf(":");
      if (idx <= 0) die(`Invalid --header (expected "Name: value"): ${value}`);
      options.headers = options.headers ?? {};
      options.headers[value.slice(0, idx).trim()] = value.slice(idx + 1).trim();
    } else if (arg === "--body") {
      options.body = loadValue(next());
    } else if (arg === "--listing") {
      try {
        options.listing = parseListing(next());
      } catch (err) {
        die(`Invalid --listing: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (arg === "--rpc") {
      options.rpcUrls = options.rpcUrls ?? [];
      options.rpcUrls.push(next());
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(next());
      if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) die("Invalid --timeout-ms");
    } else if (arg.startsWith("-")) {
      die(`Unknown option ${arg}\n\n${USAGE}`);
    } else if (!url) {
      url = arg;
    } else {
      die(`Unexpected argument ${arg}\n\n${USAGE}`);
    }
  }
  if (!url) die(`A URL is required\n\n${USAGE}`);
  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    die(`Invalid URL: ${url}`);
  }
  if (options.rpcUrls && options.rpcUrls.length === 0) delete options.rpcUrls;
  return { url, options, json };
}

function formatHuman(result: CheckResult): string {
  const lines: string[] = [];
  lines.push(`verdict: ${result.verdict.toUpperCase()}`);
  lines.push(`url: ${result.endpoint.method} ${result.endpoint.url}`);
  lines.push(
    `status: ${result.endpoint.status ?? "n/a"}  latency: ${result.endpoint.latencyMs} ms  checked: ${result.checkedAt}`,
  );
  if (result.selected) {
    const s = result.selected;
    lines.push(
      `terms: scheme=${s.scheme} network=${s.network} amount=${s.amount} asset=${s.asset} payTo=${s.payTo}`,
    );
  }
  if (result.payTo) {
    const p = result.payTo;
    const parts = [
      p.kind ? `kind=${p.kind}` : null,
      p.nonce !== undefined ? `nonce=${p.nonce}` : null,
      p.ageDays !== undefined ? `ageDays=${p.ageDays}` : null,
      p.firstSeenAt ? `firstSeen=${p.firstSeenAt}` : null,
      p.nativeBalanceEth ? `eth=${p.nativeBalanceEth}` : null,
      p.tokenBalanceFormatted ? `token=${p.tokenBalanceFormatted}` : null,
    ].filter(Boolean);
    if (parts.length) lines.push(`payTo: ${parts.join("  ")}`);
  }
  lines.push("reasons:");
  for (const reason of result.reasons) {
    lines.push(`  - [${reason.severity}] ${reason.code}: ${reason.message}`);
  }
  return lines.join("\n") + "\n";
}

function exitCode(verdict: Verdict): number {
  if (verdict === "allow") return 0;
  if (verdict === "warn") return 1;
  return 2;
}

async function main(): Promise<void> {
  const { url, options, json } = parseArgs(process.argv.slice(2));
  const result = await runCheck(url, options);
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(formatHuman(result));
  }
  process.exit(exitCode(result.verdict));
}

main().catch((err) => {
  die(err instanceof Error ? err.message : String(err));
});
