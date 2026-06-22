// scrape.js — World Hype News scraper.
// Pulls real news for all 8 channels from publisher RSS + Google News,
// enriches (category, tags, sentiment, impact, hype boost, tickers, subcategory),
// merges into a growing feed.json (deduped, timestamped), capped to keep it light.
// No API keys. Runs in GitHub Actions on a schedule.

import Parser from "rss-parser";
import fs from "fs";

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "WorldHypeNews/1.0 (+https://worldhypenews.com)" },
  customFields: { item: [["media:content", "media", { keepArray: true }], ["media:thumbnail", "thumb"], "content:encoded"] },
});

const MAX_ITEMS = 1500;          // total archive size kept in feed.json
const MAX_PER_SOURCE = 25;       // items taken per feed per run
const FEED_FILE = "feed.json";

// ---- sources -------------------------------------------------------------
// Publisher RSS (real summaries + often images), tagged by channel.
const RSS = [
  // crypto
  ["crypto", "https://www.coindesk.com/arc/outboundfeeds/rss/"],
  ["crypto", "https://cointelegraph.com/rss"],
  ["crypto", "https://decrypt.co/feed"],
  // stocks
  ["stocks", "http://feeds.marketwatch.com/marketwatch/topstories/"],
  ["stocks", "https://www.cnbc.com/id/100003114/device/rss/rss.html"],
  // tech / AI
  ["tech", "https://techcrunch.com/feed/"],
  ["tech", "https://www.theverge.com/rss/index.xml"],
  ["tech", "http://feeds.arstechnica.com/arstechnica/index"],
  // politics
  ["politics", "https://thehill.com/news/feed/"],
  ["politics", "https://feeds.npr.org/1014/rss.xml"],
  // world
  ["world", "http://feeds.bbci.co.uk/news/world/rss.xml"],
  ["world", "https://www.aljazeera.com/xml/rss/all.xml"],
  // viral / culture
  ["viral", "https://mashable.com/feeds/rss/all"],
];

// Google News RSS search (great for the thin channels). English only.
const GNEWS = [
  ["meme", "memecoin OR dogecoin OR \"meme coin\" OR pump.fun"],
  ["x", "Elon Musk OR SpaceX OR xAI OR Grok OR Tesla OR Neuralink"],
  ["viral", "goes viral OR viral video OR trending online"],
  ["politics", "US election OR Congress OR White House OR tariffs"],
  ["crypto", "bitcoin OR ethereum OR solana OR crypto ETF"],
  ["tech", "OpenAI OR ChatGPT OR Anthropic OR artificial intelligence"],
];
const gnewsUrl = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

// ---- enrichment ----------------------------------------------------------
const SUBS = {
  crypto: [["Bitcoin", ["bitcoin", "btc"]], ["Ethereum", ["ethereum", "eth"]], ["Solana", ["solana", " sol "]], ["DeFi", ["defi", "stablecoin", "etf", "exchange"]]],
  stocks: [["Earnings", ["earnings", "revenue", "guidance"]], ["Fed & Rates", ["fed", "powell", "rate", "inflation"]], ["IPOs", ["ipo", "s-1", "debut"]], ["Big Tech", ["nvidia", "apple", "microsoft", "tesla"]]],
  tech: [["AI Labs", ["openai", "anthropic", "gemini", "model", "chatgpt", "claude", "grok"]], ["Startups", ["startup", "founder", "launch"]], ["Hardware", ["chip", "gpu", "semiconductor", "device", "robot"]], ["Funding", ["raise", "funding", "round", "valuation", "series "]]],
  politics: [["Elections", ["election", "vote", "campaign", "poll"]], ["Policy", ["bill", "law", "regulation", "tariff", "sanction"]], ["White House", ["white house", "president", "biden", "trump"]], ["Congress", ["congress", "senate", "house"]]],
  world: [["Conflict", ["war", "ceasefire", "strike", "military"]], ["Economy", ["economy", "trade", "oil", "market"]], ["Disasters", ["earthquake", "storm", "flood", "wildfire", "outbreak"]], ["Diplomacy", ["summit", "talks", "treaty", "deal"]]],
  viral: [["Trending", ["viral", "trend", "tiktok"]], ["Culture", ["celebrity", "music", "movie", "show"]], ["Internet", ["meme", "reddit", "youtube", "online"]], ["Sports", ["nba", "nfl", "soccer", "game"]]],
  meme: [["Solana memes", ["solana", "bonk", "wif", "pump.fun"]], ["Dogecoin", ["dogecoin", "doge"]], ["New launches", ["launch", "presale", "new"]], ["Movers", ["surge", "pump", "rally", "soar"]]],
  x: [["Elon", ["elon", "musk"]], ["SpaceX", ["spacex", "starship", "rocket"]], ["xAI / Grok", ["xai", "grok"]], ["Tesla", ["tesla", "cybertruck"]]],
};
const HYPE = ["elon", "musk", "spacex", "xai", "grok", "tesla", "neuralink", "openai", "altman", "chatgpt", "claude", "anthropic", "gemini", "bitcoin", "btc", "ethereum", "solana", "dogecoin", "memecoin", "nvidia", "fed", "powell"];
const TICKERS = { bitcoin: "BTC", ethereum: "ETH", solana: "SOL", dogecoin: "DOGE", nvidia: "NVDA", tesla: "TSLA", coinbase: "COIN", microstrategy: "MSTR", palantir: "PLTR", apple: "AAPL" };

const hasW = (t, w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(t);
const countW = (t, ws) => ws.reduce((n, w) => n + (hasW(t, w) ? 1 : 0), 0);
const NON_LATIN = /[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;

function sub(cat, t) {
  for (const [label, ws] of (SUBS[cat] || [])) if (countW(t, ws)) return label;
  return (SUBS[cat] && SUBS[cat][0][0]) || "";
}
function tag(t) {
  if (countW(t, ["breaking", "just in", "live updates"])) return "breaking";
  if (countW(t, ["surge", "soar", "rally", "record high", "all-time high", "jumps", "rips"])) return "bull";
  if (countW(t, ["plunge", "crash", "dump", "tumble", "selloff", "hack", "ban", "lawsuit", "falls"])) return "bear";
  if (countW(t, ["viral", "tiktok"])) return "viral";
  if (countW(t, ["etf", "fed", "earnings", "ipo", "nvidia", "rate"])) return "market";
  return "market";
}
function clean(html) {
  if (!html) return "";
  return String(html).replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}
function imageFrom(item) {
  if (item.enclosure && /^https?:/.test(item.enclosure.url || "")) return item.enclosure.url;
  if (item.media && item.media[0] && item.media[0].$ && item.media[0].$.url) return item.media[0].$.url;
  if (item.thumb && item.thumb.$ && item.thumb.$.url) return item.thumb.$.url;
  const m = /<img[^>]+src="([^"]+)"/i.exec(item["content:encoded"] || item.content || "");
  return m ? m[1] : undefined;
}
function domainOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "news"; } }

function makeStory(cat, item) {
  const title = (item.title || "").trim();
  const url = item.link || "";
  if (!title || !url || NON_LATIN.test(title)) return null;
  const raw = item["content:encoded"] || item.content || item.contentSnippet || item.summary || item.description || "";
  const body = clean(raw).slice(0, 1600) || title;
  const lo = ` ${title.toLowerCase()} ${body.toLowerCase()} `;
  const when = item.isoDate || item.pubDate || new Date().toISOString();
  const ageMin = Math.max(0, (Date.now() - new Date(when).getTime()) / 60000);
  const hype = countW(lo, HYPE);
  const tg = tag(lo);
  const recency = Math.max(0, 1 - ageMin / (60 * 48));
  const impact = Math.min(99, Math.round(45 + 30 * recency + Math.min(15, hype * 8) + (tg === "breaking" ? 8 : tg === "market" ? 6 : 0)));
  const tickers = [];
  (title.match(/\$([A-Za-z]{2,6})\b/g) || []).forEach((m) => tickers.push(m.slice(1).toUpperCase()));
  for (const [k, v] of Object.entries(TICKERS)) if (hasW(lo, k) && !tickers.includes(v)) tickers.push(v);
  return {
    id: url,
    cat, sub: sub(cat, lo), tag: tg,
    sent: tg === "bull" ? "bull" : tg === "bear" ? "bear" : "neutral",
    impact, title, src: (item.creator || domainOf(url)), author: item.creator || "",
    body, url, imageUrl: imageFrom(item), imageCredit: domainOf(url),
    tickers, publishedAt: new Date(when).toISOString(),
  };
}

async function pullRss(cat, url) {
  try {
    const feed = await parser.parseURL(url);
    return (feed.items || []).slice(0, MAX_PER_SOURCE).map((it) => makeStory(cat, it)).filter(Boolean);
  } catch (e) { console.log("skip", url, String(e.message || e)); return []; }
}

async function main() {
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(FEED_FILE, "utf8")); } catch { existing = []; }
  const byId = new Map(existing.map((s) => [s.id, s]));

  const jobs = [
    ...RSS.map(([cat, url]) => pullRss(cat, url)),
    ...GNEWS.map(([cat, q]) => pullRss(cat, gnewsUrl(q))),
  ];
  const results = await Promise.allSettled(jobs);

  let added = 0;
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const s of r.value) {
      if (!byId.has(s.id)) { byId.set(s.id, s); added++; }
    }
  }

  const all = [...byId.values()]
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, MAX_ITEMS);

  fs.writeFileSync(FEED_FILE, JSON.stringify(all));
  const counts = {};
  for (const s of all) counts[s.cat] = (counts[s.cat] || 0) + 1;
  console.log(`feed.json: ${all.length} total (+${added} new)`, counts);
}

main();
