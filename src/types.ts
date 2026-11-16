export type Verdict = "allow" | "warn" | "deny";

export type ReasonSeverity = "info" | "warn" | "deny";

export interface Reason {
  severity: ReasonSeverity;
  code: string;
  message: string;
}

export interface PaymentRequirement {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
  resource?: string;
}

export interface PaymentRequired {
  x402Version: number | string | null;
  source: "header" | "body";
  error?: string;
  resource?: unknown;
  accepts: PaymentRequirement[];
  extensions?: unknown;
  raw: unknown;
}

export interface ListingExpectation {
  payTo?: string;
  amount?: string;
  asset?: string;
  network?: string;
}

export interface EndpointProbe {
  url: string;
  method: string;
  status: number | null;
  latencyMs: number;
  ok: boolean;
  error?: string;
  contentType?: string | null;
}

export interface PayToReport {
  network: string;
  address: string;
  kind?: "eoa" | "contract" | "unknown";
  nonce?: number;
  nativeBalanceWei?: string;
  nativeBalanceEth?: string;
  tokenSymbol?: string;
  tokenBalance?: string;
  tokenBalanceFormatted?: string;
  firstSeenAt?: string;
  ageDays?: number;
  ageSource?: string;
  notes: string[];
  error?: string;
}

export interface CheckResult {
  verdict: Verdict;
  reasons: Reason[];
  checkedAt: string;
  endpoint: EndpointProbe;
  paymentRequired?: PaymentRequired;
  selected?: PaymentRequirement;
  listing?: ListingExpectation;
  listingComparison?: Reason[];
  payTo?: PayToReport;
}

export interface CheckOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  listing?: ListingExpectation;
  rpcUrls?: string[];
  timeoutMs?: number;
}
