import {
  EXPLORER_BY_CHAIN,
  formatAtomicAmount,
  isEvmNetwork,
  isValidEvmAddress,
  lookupAsset,
  normalizeNetwork,
} from "./assets.js";
import type { PayToReport } from "./types.js";

interface RpcResponse<T> {
  result?: T;
  error?: { code?: number; message?: string };
}

async function rpcCall<T>(urls: string[], method: string, params: unknown[], timeoutMs: number): Promise<T> {
  let lastError: string = "no RPC URLs";
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal,
      });
      if (!res.ok) {
        lastError = `${url} HTTP ${res.status}`;
        continue;
      }
      const body = (await res.json()) as RpcResponse<T>;
      if (body.error) {
        lastError = `${url} ${body.error.message ?? "rpc error"}`;
        continue;
      }
      if (body.result === undefined) {
        lastError = `${url} missing result`;
        continue;
      }
      return body.result;
    } catch (err) {
      lastError = `${url} ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastError);
}

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function hexToBigInt(hex: string | undefined): bigint {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

async function firstSeen(
  network: string,
  address: string,
  timeoutMs: number,
): Promise<{ firstSeenAt?: string; ageDays?: number; source?: string; note?: string }> {
  const explorer = EXPLORER_BY_CHAIN[normalizeNetwork(network)];
  if (!explorer) return { note: "No public explorer configured for this network" };

  const read = async (url: string): Promise<{ timestamp?: number; error?: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
      if (!res.ok) return { error: `${explorer.name} returned HTTP ${res.status}` };
      const body = (await res.json()) as { status?: string; result?: Array<{ timeStamp?: string; timestamp?: string }> };
      const first = Array.isArray(body.result) ? body.result[0] : undefined;
      const ts = first?.timeStamp ?? first?.timestamp;
      if (!ts) return {};
      return { timestamp: Number(ts) };
    } catch (err) {
      return { error: `${explorer.name} lookup failed: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      clearTimeout(timer);
    }
  };

  const native = await read(explorer.txlist(address));
  const token = native.timestamp ? native : await read(explorer.tokentx(address));
  const timestamp = token.timestamp;
  if (!timestamp) {
    const error = native.error ?? token.error;
    return { note: error ?? `No transactions found via ${explorer.name}` };
  }
  const firstSeenAt = new Date(timestamp * 1000).toISOString();
  const ageDays = (Date.now() / 1000 - timestamp) / 86400;
  return { firstSeenAt, ageDays, source: explorer.name };
}

export async function inspectPayTo(options: {
  network: string;
  address: string;
  asset?: string;
  rpcUrls: string[];
  timeoutMs: number;
}): Promise<PayToReport> {
  const network = normalizeNetwork(options.network);
  const address = options.address;
  const notes: string[] = [];
  const report: PayToReport = { network, address, notes };

  if (!isEvmNetwork(network)) {
    report.kind = "unknown";
    report.error = "Wallet inspection is implemented for EVM networks only";
    notes.push(report.error);
    return report;
  }
  if (!isValidEvmAddress(address)) {
    report.kind = "unknown";
    report.error = "payTo is not a valid EVM address";
    notes.push(report.error);
    return report;
  }

  try {
    const [code, nonceHex, balanceHex] = await Promise.all([
      rpcCall<string>(options.rpcUrls, "eth_getCode", [address, "latest"], options.timeoutMs),
      rpcCall<string>(options.rpcUrls, "eth_getTransactionCount", [address, "latest"], options.timeoutMs),
      rpcCall<string>(options.rpcUrls, "eth_getBalance", [address, "latest"], options.timeoutMs),
    ]);
    const codeValue = code && code !== "0x" && code !== "0x0";
    report.kind = codeValue ? "contract" : "eoa";
    report.nonce = Number(hexToBigInt(nonceHex));
    const wei = hexToBigInt(balanceHex);
    report.nativeBalanceWei = wei.toString();
    report.nativeBalanceEth = formatAtomicAmount(wei.toString(), 18);

    if (options.asset && isValidEvmAddress(options.asset)) {
      const data = `0x70a08231${padAddress(address)}`;
      const tokenHex = await rpcCall<string>(
        options.rpcUrls,
        "eth_call",
        [{ to: options.asset, data }, "latest"],
        options.timeoutMs,
      );
      const tokenBal = hexToBigInt(tokenHex);
      const known = lookupAsset(network, options.asset);
      report.tokenSymbol = known?.symbol;
      report.tokenBalance = tokenBal.toString();
      report.tokenBalanceFormatted = known
        ? `${formatAtomicAmount(tokenBal.toString(), known.decimals)} ${known.symbol}`
        : tokenBal.toString();
    }
  } catch (err) {
    report.error = `RPC lookup failed: ${err instanceof Error ? err.message : String(err)}`;
    notes.push(report.error);
    return report;
  }

  const seen = await firstSeen(network, address, Math.min(options.timeoutMs, 4000));
  if (seen.firstSeenAt) {
    report.firstSeenAt = seen.firstSeenAt;
    report.ageDays = seen.ageDays !== undefined ? Math.round(seen.ageDays * 10) / 10 : undefined;
    report.ageSource = seen.source;
  } else if (seen.note) {
    notes.push(seen.note);
  }

  return report;
}

export function defaultRpcUrls(network: string, overrides?: string[]): string[] {
  if (overrides && overrides.length > 0) return overrides;
  const n = normalizeNetwork(network);
  if (n === "eip155:84532") {
    return ["https://sepolia.base.org"];
  }
  return ["https://mainnet.base.org", "https://base.publicnode.com", "https://base.llamarpc.com"];
}
