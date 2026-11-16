export interface KnownAsset {
  symbol: string;
  decimals: number;
  name: string;
}

/** Well-known USD-pegged assets used only to label amounts. Lookups are lowercase. */
export const KNOWN_ASSETS: Record<string, KnownAsset> = {
  // USDC on Base mainnet
  "eip155:8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
    symbol: "USDC",
    decimals: 6,
    name: "USD Coin",
  },
  // USDC on Base Sepolia
  "eip155:84532:0x036cbd53842c5426634e7929541ec2318f3dcf7e": {
    symbol: "USDC",
    decimals: 6,
    name: "USD Coin",
  },
  // EURC on Base mainnet
  "eip155:8453:0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42": {
    symbol: "EURC",
    decimals: 6,
    name: "EURC",
  },
};

export const DEFAULT_BASE_RPCS = [
  "https://mainnet.base.org",
  "https://base.publicnode.com",
  "https://base.llamarpc.com",
];

export const DEFAULT_BASE_SEPOLIA_RPCS = [
  "https://sepolia.base.org",
];

export const EXPLORER_BY_CHAIN: Record<string, { name: string; txlist: (address: string) => string; tokentx: (address: string) => string }> = {
  "eip155:8453": {
    name: "Base Blockscout",
    txlist: (address) =>
      `https://base.blockscout.com/api?module=account&action=txlist&address=${address}&page=1&offset=1&sort=asc`,
    tokentx: (address) =>
      `https://base.blockscout.com/api?module=account&action=tokentx&address=${address}&page=1&offset=1&sort=asc`,
  },
  "eip155:84532": {
    name: "Base Sepolia Blockscout",
    txlist: (address) =>
      `https://base-sepolia.blockscout.com/api?module=account&action=txlist&address=${address}&page=1&offset=1&sort=asc`,
    tokentx: (address) =>
      `https://base-sepolia.blockscout.com/api?module=account&action=tokentx&address=${address}&page=1&offset=1&sort=asc`,
  },
};

export function normalizeNetwork(network: string | undefined | null): string {
  if (!network) return "";
  const n = network.trim().toLowerCase();
  if (n === "base" || n === "base-mainnet" || n === "base_mainnet") return "eip155:8453";
  if (n === "base-sepolia" || n === "base_sepolia" || n === "basesepolia") return "eip155:84532";
  return network.trim();
}

export function isEvmNetwork(network: string): boolean {
  return normalizeNetwork(network).startsWith("eip155:");
}

export function isBaseMainnet(network: string): boolean {
  return normalizeNetwork(network) === "eip155:8453";
}

export function isBaseSepolia(network: string): boolean {
  return normalizeNetwork(network) === "eip155:84532";
}

export function isValidEvmAddress(value: string | undefined | null): boolean {
  return !!value && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function evmAddressKey(address: string): string {
  return address.toLowerCase();
}

export function assetKey(network: string, asset: string): string {
  return `${normalizeNetwork(network)}:${asset.toLowerCase()}`;
}

export function lookupAsset(network: string, asset: string): KnownAsset | undefined {
  return KNOWN_ASSETS[assetKey(network, asset)];
}

export function formatAtomicAmount(amount: string, decimals: number): string {
  try {
    const value = BigInt(amount);
    const base = 10n ** BigInt(decimals);
    const whole = value / base;
    const frac = value % base;
    if (frac === 0n) return whole.toString();
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole.toString()}.${fracStr}`;
  } catch {
    return amount;
  }
}
