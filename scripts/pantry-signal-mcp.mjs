#!/usr/bin/env node

const apiBaseUrl = process.env.PANTRY_SIGNAL_URL ?? "http://127.0.0.1:3000";
const sharedSecret = process.env.HERMES_SHARED_SECRET;

const tools = [{
  name: "search_deal_candidates",
  description: "Find a high-recall set of current grocery-deal candidates for a natural-language shopping need. This is the primary tool for deal questions. Use exact scope for the requested item, substitutes when workable alternatives are welcome, and related for a meal or shopping occasion. Request enough results to report every relevant candidate, not just a single recommendation. Encode factual requirements such as BOGO, retailer, price, and coupon rules as filters. Every candidate includes telegramLink: when mentioning a product in Telegram, use that value verbatim as its name. Results are candidates with retrieval evidence, not final recommendations; retrieve details for products you recommend. Do not claim no matching deal exists unless retrievalComplete is true.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural-language product or shopping need, such as 'hot dog buns' or 'ingredients for tacos'." },
      scope: { type: "string", enum: ["exact", "substitutes", "related"], default: "exact", description: "Whether to include only the requested item, usable substitutes, or complementary meal items." },
      retailers: { type: "array", items: { type: "string", enum: ["publix", "costco", "wholefoods"] }, description: "Optional factual retailer restriction." },
      activeOnly: { type: "boolean", default: true, description: "Require offers active now." },
      promotionKinds: { type: "array", items: { type: "string", enum: ["unit_price", "multi_buy", "buy_x_get_y", "amount_off", "percent_off", "threshold_discount", "unknown"] }, description: "Optional promotion-type filter. Use buy_x_get_y for BOGO." },
      couponRequired: { type: "boolean", description: "Optional factual coupon requirement filter." },
      maximumPrice: { type: "number", minimum: 0, description: "Optional maximum displayed sale price in USD." },
      sort: { type: "string", enum: ["relevance", "discount_amount", "discount_percent"], default: "relevance", description: "Order already-relevant candidates by relevance or a factual discount metric." },
      limit: { type: "integer", minimum: 1, maximum: 25, default: 12, description: "Maximum candidates to return." },
    },
    required: ["query"],
    additionalProperties: false,
  },
}, {
  name: "get_deal_details",
  description: "Verify up to 10 shortlisted stable candidate references returned by search_deal_candidates. Returns exact retailer terms, comparable pricing, validity, freshness, and proof URLs. For Telegram replies, use each returned telegramLink verbatim when naming that product.",
  inputSchema: {
    type: "object",
    properties: {
      refs: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" }, description: "Stable candidate references returned by search_deal_candidates." },
    },
    required: ["refs"],
    additionalProperties: false,
  },
}, {
  name: "get_catalog_status",
  description: "Get the active retrieval-index version, document count, and freshness for each retailer source. Use for freshness or coverage questions; search results already include this information.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
}];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function request(path, options = {}) {
  const response = await fetch(new URL(path, apiBaseUrl), {
    method: options.method ?? "GET",
    signal: AbortSignal.timeout(15_000),
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(sharedSecret ? { authorization: `Bearer ${sharedSecret}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Pantry Signal API returned ${response.status}. Start it with: npm run agent:serve`);
  return payload;
}

function markdownLink(title, url) {
  const safeTitle = title.replace(/([\\[\]])/g, "\\$1");
  return `[${safeTitle}](${url.replace(/\)/g, "%29")})`;
}

async function searchCandidates(args = {}) {
  const filters = {
    active: args.activeOnly !== false,
    ...(Array.isArray(args.promotionKinds) && args.promotionKinds.length ? { promotionKinds: args.promotionKinds } : {}),
    ...(typeof args.couponRequired === "boolean" ? { couponRequired: args.couponRequired } : {}),
    ...(typeof args.maximumPrice === "number" ? { maximumPrice: args.maximumPrice } : {}),
  };
  const result = await request("/api/agent/deals/search", {
    method: "POST",
    body: {
      query: args.query,
      scope: args.scope ?? "exact",
      ...(Array.isArray(args.retailers) && args.retailers.length ? { retailers: args.retailers } : {}),
      filters,
      sort: args.sort ?? "relevance",
      limit: args.limit ?? 12,
    },
  });
  return {
    ...result,
    candidates: result.candidates.map(({ proofUrl, ...candidate }) => ({
      ...candidate,
      proofAvailable: Boolean(proofUrl),
      telegramLink: proofUrl ? markdownLink(candidate.title, proofUrl) : undefined,
    })),
  };
}

async function details(args = {}) {
  if (!Array.isArray(args.refs) || args.refs.length < 1 || args.refs.length > 10) throw new Error("refs must contain between 1 and 10 candidate references.");
  const result = await request("/api/agent/deals/details", { method: "POST", body: { refs: args.refs } });
  return {
    ...result,
    deals: result.deals.map(({ proofUrl, ...deal }) => ({
      ...deal,
      proofAvailable: Boolean(proofUrl),
      telegramLink: proofUrl ? markdownLink(deal.title, proofUrl) : undefined,
    })),
  };
}

async function handle(message) {
  if (message.method === "notifications/initialized") return;
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "pantry-signal", version: "3.0.0" } } });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }
  if (message.method === "tools/call") {
    try {
      const result = message.params?.name === "search_deal_candidates"
        ? await searchCandidates(message.params.arguments)
        : message.params?.name === "get_deal_details"
          ? await details(message.params.arguments)
          : message.params?.name === "get_catalog_status"
            ? await request("/api/agent/deals/status")
            : (() => { throw new Error("Unknown tool."); })();
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
    } catch (error) {
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true } });
    }
    return;
  }
  if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try { void handle(JSON.parse(line)); } catch (error) { process.stderr.write(`Invalid MCP input: ${error}\n`); }
  }
});
