import { defaultRpcUrls, inspectPayTo } from "./rpc.js";
import { parsePaymentRequired, preferBaseRequirement } from "./parse.js";
import type { CheckOptions, CheckResult, EndpointProbe } from "./types.js";
import { compareListing, evaluate } from "./verdict.js";

async function probeEndpoint(
  url: string,
  method: string,
  timeoutMs: number,
  headers: Record<string, string>,
  body?: string,
): Promise<{ probe: EndpointProbe; responseHeaders: Headers; responseBody: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const init: RequestInit = {
      method,
      headers,
      redirect: "follow",
      signal: controller.signal,
    };
    if (body !== undefined && method !== "GET" && method !== "HEAD") {
      init.body = body;
    }
    const res = await fetch(url, init);
    const latencyMs = Date.now() - started;
    const responseBody = await res.text();
    return {
      probe: {
        url,
        method,
        status: res.status,
        latencyMs,
        ok: true,
        contentType: res.headers.get("content-type"),
      },
      responseHeaders: res.headers,
      responseBody,
    };
  } catch (err) {
    return {
      probe: {
        url,
        method,
        status: null,
        latencyMs: Date.now() - started,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      responseHeaders: new Headers(),
      responseBody: "",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runCheck(url: string, options: CheckOptions = {}): Promise<CheckResult> {
  const method = (options.method ?? "GET").toUpperCase();
  const timeoutMs = options.timeoutMs ?? 10_000;
  const headers: Record<string, string> = { accept: "application/json, */*", ...(options.headers ?? {}) };
  const { probe, responseHeaders, responseBody } = await probeEndpoint(url, method, timeoutMs, headers, options.body);

  let parseError: string | undefined;
  let paymentRequired: CheckResult["paymentRequired"];
  let selected: CheckResult["selected"];

  if (probe.ok) {
    const parsed = parsePaymentRequired(responseHeaders, responseBody);
    if ("error" in parsed && !("accepts" in parsed)) {
      parseError = parsed.error;
    } else if ("accepts" in parsed) {
      paymentRequired = parsed;
      selected = preferBaseRequirement(parsed.accepts);
      if (!selected) parseError = "payment requirements contained an empty accepts list";
    }
  } else {
    parseError = probe.error ?? "request failed";
  }

  const listingReasons = selected && options.listing ? compareListing(selected, options.listing) : undefined;

  let payTo: CheckResult["payTo"];
  if (selected?.payTo && selected.network) {
    payTo = await inspectPayTo({
      network: selected.network,
      address: selected.payTo,
      asset: selected.asset,
      rpcUrls: defaultRpcUrls(selected.network, options.rpcUrls),
      timeoutMs: Math.min(timeoutMs, 5000),
    });
  }

  const { verdict, reasons } = evaluate({
    reachable: probe.ok,
    status: probe.status,
    latencyMs: probe.latencyMs,
    parseError,
    selected,
    listingReasons,
    payTo,
  });

  return {
    verdict,
    reasons,
    checkedAt: new Date().toISOString(),
    endpoint: probe,
    paymentRequired,
    selected,
    listing: options.listing,
    listingComparison: listingReasons,
    payTo,
  };
}
