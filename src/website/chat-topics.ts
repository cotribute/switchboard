/**
 * Vendored verbatim from cotribute/webmaster `src/lib/chat-topics.ts`.
 *
 * These are the exact classification rules the admin dashboard uses. They are
 * copied rather than re-derived so Switchboard's numbers reconcile with what
 * GTM sees in the portal. If the portal's copy changes, re-copy this file.
 */
/**
 * Lightweight, dependency-free clustering of visitor chat questions.
 *
 * Two views:
 *  - Topic buckets: keyword rules mapped to Cotribute themes.
 *  - Top asks: frequent normalized phrases (bigrams/trigrams) with examples.
 */

export type TopicBucket = {
  topic: string;
  conversations: number;
  messages: number;
  share: number;
  examples: string[];
};

export type TopAsk = {
  phrase: string;
  count: number;
  examples: string[];
};

const STOPWORDS = new Set([
  "a",
  "about",
  "after",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "being",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "don",
  "for",
  "from",
  "get",
  "gets",
  "got",
  "had",
  "has",
  "have",
  "he",
  "her",
  "here",
  "hey",
  "hi",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "know",
  "like",
  "me",
  "more",
  "most",
  "much",
  "my",
  "need",
  "no",
  "not",
  "of",
  "ok",
  "on",
  "one",
  "only",
  "or",
  "other",
  "our",
  "out",
  "please",
  "should",
  "so",
  "some",
  "tell",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "up",
  "us",
  "use",
  "very",
  "want",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  "yours",
  "thanks",
  "thank",
  "hello",
  "does",
  "doesn",
  "isn",
  "let",
  "give",
  "show",
  "looking",
  "would",
  "could",
  "really",
  "kind",
  "sort",
]);

const TOPIC_RULES: Array<{ topic: string; patterns: RegExp }> = [
  {
    topic: "Pricing & cost",
    patterns:
      /\b(pric|cost|fee|fees|quote|budget|how much|expensive|afford|subscription|contract|per member|roi)\w*/i,
  },
  {
    topic: "Demo & next steps",
    patterns:
      /\b(demo|trial|walk ?through|meeting|call|schedule|book|talk to|sales|contact|pilot)\w*/i,
  },
  {
    topic: "Integrations & core systems",
    patterns:
      /\b(integrat|api|core|symitar|jack henry|fiserv|corelation|keystone|crm|salesforce|hubspot|webhook|sso|single sign|digital banking|q2|alkami)\w*/i,
  },
  {
    topic: "Onboarding & implementation",
    patterns:
      /\b(onboard|implement|setup|set up|launch|go live|migrat|timeline|how long|training|support)\w*/i,
  },
  {
    topic: "Security & compliance",
    patterns:
      /\b(secur|complian|soc ?2|privacy|gdpr|ccpa|encrypt|audit|ncua|regulat|risk|pii|data retention)\w*/i,
  },
  {
    topic: "Credit union / bank fit",
    patterns:
      /\b(credit union|cu\b|bank|community bank|member|members|branch|charter|asset size)\w*/i,
  },
  {
    topic: "Product capabilities",
    patterns:
      /\b(feature|capab|can you|does it|how does|work|platform|module|report|analytic|dashboard|campaign|referral|reward|loyalty|giving|donat|volunteer|survey)\w*/i,
  },
  {
    topic: "Comparison & alternatives",
    patterns:
      /\b(compare|versus|vs\b|competitor|alternativ|better than|different from)\w*/i,
  },
];

export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return normalizeQuestion(text)
    .split(" ")
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Trim a message to a short quotable snippet. */
export function snippet(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export type QuestionInput = {
  /** Conversation the question belongs to, used for de-duplicated counts. */
  conversationId: string;
  text: string;
};

export function buildTopicBuckets(questions: QuestionInput[]): TopicBucket[] {
  const totalConversations = new Set(questions.map((q) => q.conversationId))
    .size;
  const acc = new Map<
    string,
    { convs: Set<string>; messages: number; examples: string[] }
  >();
  const matchedConversations = new Set<string>();

  const bump = (topic: string, q: QuestionInput) => {
    let b = acc.get(topic);
    if (!b)
      acc.set(topic, (b = { convs: new Set(), messages: 0, examples: [] }));
    b.convs.add(q.conversationId);
    b.messages++;
    if (b.examples.length < 3) b.examples.push(snippet(q.text));
  };

  for (const q of questions) {
    let matched = false;
    for (const rule of TOPIC_RULES) {
      if (rule.patterns.test(q.text)) {
        bump(rule.topic, q);
        matched = true;
      }
    }
    if (matched) matchedConversations.add(q.conversationId);
    else bump("Other / uncategorized", q);
  }

  return [...acc.entries()]
    .map(([topic, b]) => ({
      topic,
      conversations: b.convs.size,
      messages: b.messages,
      share: totalConversations
        ? Math.round((b.convs.size / totalConversations) * 1000) / 10
        : 0,
      examples: b.examples,
    }))
    .sort(
      (a, b) => b.conversations - a.conversations || b.messages - a.messages
    );
}

export function buildTopAsks(questions: QuestionInput[], limit = 10): TopAsk[] {
  const phraseConvs = new Map<
    string,
    { convs: Set<string>; examples: string[] }
  >();

  for (const q of questions) {
    const words = tokens(q.text);
    const phrases = new Set<string>();
    for (let n = 3; n >= 2; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        phrases.add(words.slice(i, i + n).join(" "));
      }
    }
    // Single keywords still matter for very short asks like "pricing?".
    if (words.length <= 2) for (const w of words) phrases.add(w);

    for (const p of phrases) {
      let e = phraseConvs.get(p);
      if (!e) phraseConvs.set(p, (e = { convs: new Set(), examples: [] }));
      e.convs.add(q.conversationId);
      if (e.examples.length < 3) e.examples.push(snippet(q.text));
    }
  }

  const ranked = [...phraseConvs.entries()]
    .map(([phrase, e]) => ({
      phrase,
      count: e.convs.size,
      examples: e.examples,
    }))
    .filter((r) => r.count >= 2)
    .sort((a, b) => b.count - a.count || b.phrase.length - a.phrase.length);

  // Drop phrases fully contained in a longer, equally common phrase.
  const kept: TopAsk[] = [];
  for (const r of ranked) {
    const redundant = kept.some(
      (k) =>
        k.count === r.count &&
        k.phrase.includes(r.phrase) &&
        k.phrase !== r.phrase
    );
    if (!redundant) kept.push(r);
    if (kept.length >= limit) break;
  }

  // Fall back to single most-common keywords when nothing repeats yet.
  if (kept.length === 0) {
    const word = new Map<string, Set<string>>();
    for (const q of questions) {
      for (const w of tokens(q.text)) {
        let s = word.get(w);
        if (!s) word.set(w, (s = new Set()));
        s.add(q.conversationId);
      }
    }
    return [...word.entries()]
      .map(([phrase, s]) => ({ phrase, count: s.size, examples: [] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  return kept;
}
