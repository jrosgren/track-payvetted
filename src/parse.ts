import { normalizeNetwork } from "./assets.js";
import type { PaymentRequired, PaymentRequirement } from "./types.js";

function headerValue(headers: Headers, name: string): string | null {
  const direct = headers.get(name);
  if (direct) return direct;
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase() === name.toLowerCase()) return value;
  }
  return null;
}

function decodeBase64Json(value: string): unknown {
  const trimmed = value.trim().replace(/\s+/g, "");
  const padded = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const json = Buffer.from(padded + pad, "base64").toString("utf8");
  return JSON.parse(json);
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function normalizeRequirement(raw: Record<string, unknown>): PaymentRequirement | null {
  const payTo = asString(raw.payTo ?? raw.pay_to ?? raw.recipient);
  const amount = asString(raw.amount ?? raw.maxAmountRequired ?? raw.max_amount_required);
  const asset = asString(raw.asset ?? raw.token);
  const network = asString(raw.network ?? raw.chain);
  if (!payTo && !amount && !asset && !network) return null;
  return {
    scheme: asString(raw.scheme) ?? "exact",
    network: normalizeNetwork(network ?? ""),
    amount: amount ?? "",
    asset: asset ?? "",
    payTo: payTo ?? "",
    maxTimeoutSeconds: asNumber(raw.maxTimeoutSeconds ?? raw.max_timeout_seconds),
    extra: typeof raw.extra === "object" && raw.extra !== null ? (raw.extra as Record<string, unknown>) : undefined,
    resource: asString(raw.resource),
  };
}

function extractAccepts(payload: unknown): { version: number | string | null; accepts: PaymentRequirement[]; error?: string; resource?: unknown; extensions?: unknown } {
  if (!payload || typeof payload !== "object") {
    return { version: null, accepts: [] };
  }
  const obj = payload as Record<string, unknown>;
  const version = (obj.x402Version ?? obj.x402_version ?? null) as number | string | null;
  const list = Array.isArray(obj.accepts)
    ? obj.accepts
    : Array.isArray(obj.accepted)
      ? obj.accepted
      : Array.isArray(obj.paymentRequirements)
        ? obj.paymentRequirements
        : obj.paymentRequirement
          ? [obj.paymentRequirement]
          : [];
  const accepts = list
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => normalizeRequirement(item))
    .filter((item): item is PaymentRequirement => item !== null);
  return {
    version,
    accepts,
    error: asString(obj.error),
    resource: obj.resource,
    extensions: obj.extensions,
  };
}

function tryParseJsonBody(body: string): unknown | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function parsePaymentRequired(headers: Headers, body: string): PaymentRequired | { error: string } {
  const header = headerValue(headers, "PAYMENT-REQUIRED") ?? headerValue(headers, "X-PAYMENT-REQUIRED");
  if (header) {
    try {
      const raw = decodeBase64Json(header);
      const extracted = extractAccepts(raw);
      if (extracted.accepts.length === 0) {
        return { error: "PAYMENT-REQUIRED header decoded but contained no payment requirements" };
      }
      return {
        x402Version: extracted.version,
        source: "header",
        error: extracted.error,
        resource: extracted.resource,
        accepts: extracted.accepts,
        extensions: extracted.extensions,
        raw,
      };
    } catch (err) {
      return { error: `PAYMENT-REQUIRED header was not valid base64 JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const parsed = tryParseJsonBody(body);
  if (parsed) {
    const extracted = extractAccepts(parsed);
    if (extracted.accepts.length > 0) {
      return {
        x402Version: extracted.version,
        source: "body",
        error: extracted.error,
        resource: extracted.resource,
        accepts: extracted.accepts,
        extensions: extracted.extensions,
        raw: parsed,
      };
    }
  }

  return { error: "No PAYMENT-REQUIRED header and no payment requirements in the response body" };
}

export function preferBaseRequirement(accepts: PaymentRequirement[]): PaymentRequirement | undefined {
  return (
    accepts.find((item) => item.network === "eip155:8453") ??
    accepts.find((item) => item.network === "eip155:84532") ??
    accepts.find((item) => item.network.startsWith("eip155:")) ??
    accepts[0]
  );
}
