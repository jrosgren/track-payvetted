import {
  evmAddressKey,
  formatAtomicAmount,
  isBaseMainnet,
  isBaseSepolia,
  isValidEvmAddress,
  lookupAsset,
  normalizeNetwork,
} from "./assets.js";
import type { ListingExpectation, PayToReport, PaymentRequirement, Reason, Verdict } from "./types.js";

const YOUNG_WALLET_DAYS = 7;
const SLOW_MS = 2000;

export function compareListing(selected: PaymentRequirement, listing: ListingExpectation): Reason[] {
  const reasons: Reason[] = [];
  if (listing.payTo) {
    if (!selected.payTo || evmAddressKey(selected.payTo) !== evmAddressKey(listing.payTo)) {
      reasons.push({
        severity: "deny",
        code: "payto_mismatch",
        message: `payTo ${selected.payTo || "(missing)"} does not match the listed address ${listing.payTo}`,
      });
    } else {
      reasons.push({
        severity: "info",
        code: "payto_matches_listing",
        message: "payTo matches the listing",
      });
    }
  }
  if (listing.network) {
    if (normalizeNetwork(selected.network) !== normalizeNetwork(listing.network)) {
      reasons.push({
        severity: "deny",
        code: "network_mismatch",
        message: `network ${selected.network || "(missing)"} does not match the listed network ${listing.network}`,
      });
    }
  }
  if (listing.asset) {
    if (!selected.asset || evmAddressKey(selected.asset) !== evmAddressKey(listing.asset)) {
      reasons.push({
        severity: "deny",
        code: "asset_mismatch",
        message: `asset ${selected.asset || "(missing)"} does not match the listed asset ${listing.asset}`,
      });
    }
  }
  if (listing.amount) {
    try {
      const advertised = BigInt(selected.amount);
      const listed = BigInt(listing.amount);
      if (advertised > listed) {
        reasons.push({
          severity: "deny",
          code: "price_above_listing",
          message: `advertised amount ${selected.amount} is higher than the listed amount ${listing.amount}`,
        });
      } else if (advertised < listed) {
        reasons.push({
          severity: "warn",
          code: "price_below_listing",
          message: `advertised amount ${selected.amount} is lower than the listed amount ${listing.amount}`,
        });
      } else {
        reasons.push({
          severity: "info",
          code: "price_matches_listing",
          message: "advertised amount matches the listing",
        });
      }
    } catch {
      reasons.push({
        severity: "deny",
        code: "price_unparseable",
        message: `could not compare advertised amount ${selected.amount} with listed amount ${listing.amount}`,
      });
    }
  }
  return reasons;
}

export function evaluate(input: {
  reachable: boolean;
  status: number | null;
  latencyMs: number;
  parseError?: string;
  selected?: PaymentRequirement;
  listingReasons?: Reason[];
  payTo?: PayToReport;
}): { verdict: Verdict; reasons: Reason[] } {
  const reasons: Reason[] = [];

  if (!input.reachable) {
    reasons.push({ severity: "deny", code: "unreachable", message: "endpoint was not reachable" });
  } else if (input.parseError) {
    const status = input.status !== null ? `HTTP ${input.status}` : "no HTTP status";
    reasons.push({
      severity: "deny",
      code: "unparseable_requirements",
      message: `${status}: ${input.parseError}`,
    });
  } else if (input.status !== 402) {
    reasons.push({
      severity: "warn",
      code: "unexpected_status",
      message: `payment requirements were parsed from HTTP ${input.status}, not 402`,
    });
  } else {
    reasons.push({
      severity: "info",
      code: "healthy_402",
      message: `endpoint returned HTTP 402 in ${input.latencyMs} ms`,
    });
  }

  if (input.reachable && input.latencyMs > SLOW_MS) {
    reasons.push({
      severity: "warn",
      code: "slow_endpoint",
      message: `latency ${input.latencyMs} ms exceeds ${SLOW_MS} ms`,
    });
  }

  const selected = input.selected;
  if (selected) {
    if (!selected.payTo) {
      reasons.push({ severity: "deny", code: "missing_payto", message: "payment requirements omit payTo" });
    } else if (selected.network.startsWith("eip155:") && !isValidEvmAddress(selected.payTo)) {
      reasons.push({
        severity: "deny",
        code: "invalid_payto",
        message: `payTo ${selected.payTo} is not a valid EVM address`,
      });
    }

    if (!selected.amount) {
      reasons.push({ severity: "deny", code: "missing_amount", message: "payment requirements omit amount" });
    } else {
      try {
        if (BigInt(selected.amount) <= 0n) {
          reasons.push({ severity: "deny", code: "zero_amount", message: "advertised amount is zero" });
        }
      } catch {
        reasons.push({
          severity: "deny",
          code: "invalid_amount",
          message: `advertised amount ${selected.amount} is not an integer`,
        });
      }
    }

    if (!selected.asset) {
      reasons.push({ severity: "deny", code: "missing_asset", message: "payment requirements omit asset" });
    }
    if (!selected.network) {
      reasons.push({ severity: "deny", code: "missing_network", message: "payment requirements omit network" });
    } else if (!isBaseMainnet(selected.network)) {
      reasons.push({
        severity: "warn",
        code: isBaseSepolia(selected.network) ? "testnet" : "not_base_mainnet",
        message: `network is ${selected.network}, not Base mainnet (eip155:8453)`,
      });
    }

    if (selected.network && selected.asset) {
      const known = lookupAsset(selected.network, selected.asset);
      if (known) {
        reasons.push({
          severity: "info",
          code: "known_asset",
          message: `asset is ${known.symbol} (${formatAtomicAmount(selected.amount || "0", known.decimals)} ${known.symbol})`,
        });
      } else {
        reasons.push({
          severity: "warn",
          code: "unknown_asset",
          message: `asset ${selected.asset} is not a known USD-pegged token on ${selected.network}`,
        });
      }
    }
  }

  if (input.listingReasons) reasons.push(...input.listingReasons);

  const payTo = input.payTo;
  if (payTo) {
    if (payTo.kind === "contract") {
      reasons.push({
        severity: "warn",
        code: "payto_is_contract",
        message: `payTo ${payTo.address} is a contract, not an EOA`,
      });
    } else if (payTo.kind === "eoa") {
      reasons.push({
        severity: "info",
        code: "payto_is_eoa",
        message: `payTo ${payTo.address} is an EOA (nonce ${payTo.nonce ?? "unknown"})`,
      });
    }
    if (payTo.kind === "eoa" && payTo.nonce === 0) {
      reasons.push({
        severity: "warn",
        code: "payto_unused_nonce",
        message: "payTo EOA has nonce 0 (no outbound transactions)",
      });
    }
    if (payTo.ageDays !== undefined && payTo.ageDays < YOUNG_WALLET_DAYS) {
      reasons.push({
        severity: "warn",
        code: "payto_young",
        message: `payTo first seen ${payTo.firstSeenAt ?? "recently"} (${payTo.ageDays} days ago)`,
      });
    } else if (payTo.firstSeenAt && payTo.ageDays !== undefined) {
      reasons.push({
        severity: "info",
        code: "payto_age",
        message: `payTo first seen ${payTo.firstSeenAt} (${payTo.ageDays} days ago, ${payTo.ageSource ?? "explorer"})`,
      });
    }
    if (payTo.tokenBalanceFormatted) {
      reasons.push({
        severity: "info",
        code: "payto_token_balance",
        message: `payTo token balance ${payTo.tokenBalanceFormatted}`,
      });
    }
    if (payTo.nativeBalanceEth) {
      reasons.push({
        severity: "info",
        code: "payto_native_balance",
        message: `payTo native balance ${payTo.nativeBalanceEth} ETH`,
      });
    }
    if (payTo.error) {
      reasons.push({
        severity: "warn",
        code: "payto_lookup_failed",
        message: payTo.error,
      });
    }
  }

  const verdict: Verdict = reasons.some((r) => r.severity === "deny")
    ? "deny"
    : reasons.some((r) => r.severity === "warn")
      ? "warn"
      : "allow";
  return { verdict, reasons };
}
