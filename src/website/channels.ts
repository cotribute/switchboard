/**
 * Vendored verbatim from cotribute/webmaster `src/lib/channels.ts`.
 *
 * These are the exact classification rules the admin dashboard uses. They are
 * copied rather than re-derived so Switchboard's numbers reconcile with what
 * GTM sees in the portal. If the portal's copy changes, re-copy this file.
 */
/**
 * Traffic channel classification.
 *
 * Turns a raw referrer + utm payload into a coarse marketing channel, with a
 * dedicated "AI assistant" bucket so clicks arriving from ChatGPT, Perplexity,
 * Claude, Gemini and friends can be attributed instead of landing in "Referral".
 */

export type Channel =
  | "AI assistant"
  | "Organic search"
  | "Paid"
  | "Social"
  | "Email"
  | "Referral"
  | "Direct";

export const CHANNELS: Channel[] = [
  "AI assistant",
  "Organic search",
  "Paid",
  "Social",
  "Email",
  "Referral",
  "Direct",
];

/** host fragment → friendly engine name */
const AI_ENGINES: Array<[string, string]> = [
  ["chatgpt.com", "ChatGPT"],
  ["chat.openai.com", "ChatGPT"],
  ["openai.com", "ChatGPT"],
  ["oai.azure.com", "ChatGPT"],
  ["perplexity.ai", "Perplexity"],
  ["claude.ai", "Claude"],
  ["anthropic.com", "Claude"],
  ["gemini.google.com", "Gemini"],
  ["bard.google.com", "Gemini"],
  ["copilot.microsoft.com", "Copilot"],
  ["bing.com/chat", "Copilot"],
  ["meta.ai", "Meta AI"],
  ["grok.com", "Grok"],
  ["x.ai", "Grok"],
  ["deepseek.com", "DeepSeek"],
  ["you.com", "You.com"],
  ["phind.com", "Phind"],
  ["poe.com", "Poe"],
  ["arc.net", "Arc Search"],
  ["mistral.ai", "Le Chat"],
];

/** utm_source value fragment → friendly engine name */
const AI_UTM_SOURCES: Array<[string, string]> = [
  ["chatgpt", "ChatGPT"],
  ["openai", "ChatGPT"],
  ["perplexity", "Perplexity"],
  ["claude", "Claude"],
  ["anthropic", "Claude"],
  ["gemini", "Gemini"],
  ["bard", "Gemini"],
  ["copilot", "Copilot"],
  ["meta.ai", "Meta AI"],
  ["metaai", "Meta AI"],
  ["grok", "Grok"],
  ["deepseek", "DeepSeek"],
  ["you.com", "You.com"],
  ["phind", "Phind"],
  ["poe", "Poe"],
];

const SEARCH_HOSTS = [
  "google.",
  "bing.com",
  "duckduckgo.com",
  "search.yahoo",
  "yahoo.com",
  "search.brave.com",
  "ecosia.org",
  "baidu.com",
  "yandex.",
  "startpage.com",
  "qwant.com",
];

const SOCIAL_HOSTS = [
  "linkedin.com",
  "lnkd.in",
  "facebook.com",
  "fb.com",
  "instagram.com",
  "twitter.com",
  "t.co",
  "x.com",
  "youtube.com",
  "reddit.com",
  "tiktok.com",
  "pinterest.",
  "threads.net",
];

export type UtmLike =
  | { source?: unknown; medium?: unknown; campaign?: unknown }
  | null
  | undefined;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Reads a utm payload. Trackers write either `{ source, medium }` or the raw
 * query-param names `{ utm_source, utm_medium }` — accept both, and also a
 * JSON string, so a naming difference can't silently blank out UTM reporting.
 */
export function readUtmFields(utm: unknown): {
  source: string | null;
  medium: string | null;
  campaign: string | null;
} {
  let raw = utm;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { source: str(utm), medium: null, campaign: null };
    }
  }
  if (raw && typeof raw === "object") {
    const u = raw as Record<string, unknown>;
    return {
      source: str(u.source) ?? str(u.utm_source) ?? str(u.utmSource),
      medium: str(u.medium) ?? str(u.utm_medium) ?? str(u.utmMedium),
      campaign: str(u.campaign) ?? str(u.utm_campaign) ?? str(u.utmCampaign),
    };
  }
  return { source: null, medium: null, campaign: null };
}

function readUtm(utm: unknown): {
  source: string | null;
  medium: string | null;
} {
  const { source, medium } = readUtmFields(utm);
  return { source, medium };
}

function hostOf(referrer: string): string {
  const raw = referrer.trim().toLowerCase();
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.host + url.pathname;
  } catch {
    return raw;
  }
}

export type ChannelResult = {
  channel: Channel;
  /** Named AI engine when channel is "AI assistant", else the search/social/referral host. */
  engine: string | null;
  /** Human-friendly label, e.g. "AI assistant (Perplexity)". */
  label: string;
};

/** Detects an AI assistant from a referrer host or utm source string. */
export function detectAiEngine(
  referrer?: string | null,
  utmSource?: string | null
): string | null {
  if (referrer) {
    const host = hostOf(referrer);
    for (const [needle, name] of AI_ENGINES) {
      if (host.includes(needle)) return name;
    }
  }
  if (utmSource) {
    const s = utmSource.toLowerCase();
    for (const [needle, name] of AI_UTM_SOURCES) {
      if (s.includes(needle)) return name;
    }
  }
  return null;
}

/**
 * Classify one visit. UTM parameters win over the referrer when both exist,
 * except that an AI referrer always wins (assistants rarely set utm).
 */
export function classifyChannel(
  referrer?: string | null,
  utm?: unknown
): ChannelResult {
  const { source, medium } = readUtm(utm);
  const ref = str(referrer);

  const aiEngine = detectAiEngine(ref, source);
  if (aiEngine) {
    return {
      channel: "AI assistant",
      engine: aiEngine,
      label: `AI assistant (${aiEngine})`,
    };
  }

  const med = medium?.toLowerCase() ?? null;
  if (
    med &&
    [
      "cpc",
      "ppc",
      "paid",
      "paidsearch",
      "paid_search",
      "display",
      "retargeting",
    ].includes(med)
  ) {
    return {
      channel: "Paid",
      engine: source,
      label: source ? `Paid (${source})` : "Paid",
    };
  }
  if (med && ["email", "newsletter"].includes(med)) {
    return {
      channel: "Email",
      engine: source,
      label: source ? `Email (${source})` : "Email",
    };
  }
  if (med && ["social", "social-paid", "paid-social"].includes(med)) {
    return {
      channel: "Social",
      engine: source,
      label: source ? `Social (${source})` : "Social",
    };
  }

  const host = ref ? hostOf(ref) : null;

  if (host) {
    if (SEARCH_HOSTS.some((h) => host.includes(h))) {
      const name = host.split("/")[0].replace(/^www\./, "");
      return {
        channel: "Organic search",
        engine: name,
        label: `Organic search (${name})`,
      };
    }
    if (SOCIAL_HOSTS.some((h) => host.includes(h))) {
      const name = host.split("/")[0].replace(/^www\./, "");
      return { channel: "Social", engine: name, label: `Social (${name})` };
    }
    if (!host.includes("cotribute.com")) {
      const name = host.split("/")[0].replace(/^www\./, "");
      return { channel: "Referral", engine: name, label: `Referral (${name})` };
    }
  }

  if (source) {
    return {
      channel: "Referral",
      engine: source,
      label: `Referral (${source})`,
    };
  }

  return { channel: "Direct", engine: null, label: "Direct / unknown" };
}

export function isAiChannel(referrer?: string | null, utm?: unknown): boolean {
  return classifyChannel(referrer, utm).channel === "AI assistant";
}
