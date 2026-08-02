// Syncs sound-effect data from the owner's YouTube channel into data/sounds.json,
// then regenerates sitemap.xml. Run by .github/workflows/sync-youtube.yml.
//
// Required env vars: YOUTUBE_API_KEY, DEEPL_API_KEY

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const CHANNEL_HANDLE = "koukaon_library";
const YT_API = "https://www.googleapis.com/youtube/v3";
const DEEPL_API = "https://api-free.deepl.com/v2/translate";
const SITE_ORIGIN = "https://maincar.github.io/sound_effect_library";

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;

const DATA_PATH = path.join(process.cwd(), "data", "sounds.json");
const SITEMAP_PATH = path.join(process.cwd(), "sitemap.xml");

function requireEnv() {
  if (!YOUTUBE_API_KEY) throw new Error("Missing YOUTUBE_API_KEY env var");
  if (!DEEPL_API_KEY) throw new Error("Missing DEEPL_API_KEY env var");
}

async function ytGet(endpoint, params) {
  const url = new URL(`${YT_API}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", YOUTUBE_API_KEY);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`YouTube API ${endpoint} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function ytPaginate(endpoint, params) {
  const items = [];
  let pageToken;
  do {
    const page = await ytGet(endpoint, pageToken ? { ...params, pageToken } : params);
    items.push(...(page.items || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

async function resolveChannel() {
  const data = await ytGet("channels", {
    part: "contentDetails",
    forHandle: CHANNEL_HANDLE,
  });
  const channel = data.items && data.items[0];
  if (!channel) throw new Error(`Channel not found for handle @${CHANNEL_HANDLE}`);
  return {
    channelId: channel.id,
    uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
  };
}

async function listAllPlaylists(channelId) {
  const items = await ytPaginate("playlists", {
    part: "snippet",
    channelId,
    maxResults: 50,
  });
  return items.map((p) => ({ playlistId: p.id, title: p.snippet.title }));
}

async function buildPlaylistMembership(playlists) {
  const membership = new Map(); // videoId -> playlist title (first one wins)
  for (const playlist of playlists) {
    const items = await ytPaginate("playlistItems", {
      part: "contentDetails",
      playlistId: playlist.playlistId,
      maxResults: 50,
    });
    for (const item of items) {
      const videoId = item.contentDetails.videoId;
      if (!membership.has(videoId)) membership.set(videoId, playlist.title);
    }
  }
  return membership;
}

async function listUploads(uploadsPlaylistId) {
  const items = await ytPaginate("playlistItems", {
    part: "snippet,contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: 50,
  });
  return items.map((item) => ({
    videoId: item.contentDetails.videoId,
    title: item.snippet.title,
    publishedAt: item.contentDetails.videoPublishedAt || item.snippet.publishedAt,
    thumbnail:
      item.snippet.thumbnails?.high?.url ||
      item.snippet.thumbnails?.default?.url ||
      `https://i.ytimg.com/vi/${item.contentDetails.videoId}/hqdefault.jpg`,
  }));
}

function slugifyCategory(title) {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `cat-${Buffer.from(title).toString("hex").slice(0, 10)}`;
}

async function loadPreviousData() {
  try {
    const raw = await readFile(DATA_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildTranslationCache(previousData) {
  const cache = new Map();
  if (!previousData) return cache;
  for (const sound of previousData.sounds || []) {
    if (sound.title?.ja && sound.title?.en) cache.set(sound.title.ja, sound.title.en);
    if (sound.category?.ja && sound.category?.en) cache.set(sound.category.ja, sound.category.en);
  }
  return cache;
}

async function deeplTranslate(texts) {
  if (texts.length === 0) return [];
  const body = new URLSearchParams();
  for (const t of texts) body.append("text", t);
  body.set("target_lang", "EN");
  body.set("source_lang", "JA");
  const res = await fetch(DEEPL_API, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`DeepL API failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.translations.map((t) => t.text);
}

async function translateAll(jaTexts, cache) {
  const unique = [...new Set(jaTexts)];
  const toTranslate = unique.filter((t) => !cache.has(t));

  const BATCH_SIZE = 50;
  for (let i = 0; i < toTranslate.length; i += BATCH_SIZE) {
    const batch = toTranslate.slice(i, i + BATCH_SIZE);
    const translated = await deeplTranslate(batch);
    batch.forEach((ja, idx) => cache.set(ja, translated[idx]));
  }

  const result = new Map();
  for (const t of unique) result.set(t, cache.get(t) ?? t);
  return result;
}

async function writeOutputs(sounds) {
  await mkdir(path.dirname(DATA_PATH), { recursive: true });
  const output = {
    generatedAt: new Date().toISOString(),
    sounds,
  };
  await writeFile(DATA_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");
  await writeFile(SITEMAP_PATH, buildSitemap(sounds), "utf8");
}

function buildSitemap(sounds) {
  const urls = [
    `  <url>\n    <loc>${SITE_ORIGIN}/index.html</loc>\n  </url>`,
    ...sounds.map((s) => {
      const lastmod = s.publishedAt ? s.publishedAt.slice(0, 10) : undefined;
      const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "";
      return `  <url>\n    <loc>${SITE_ORIGIN}/index.html?sound=${s.slug}</loc>${lastmodTag}\n  </url>`;
    }),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\n${urls.join(
    "\n\n"
  )}\n\n</urlset>\n`;
}

async function main() {
  requireEnv();

  const previousData = await loadPreviousData();
  const translationCache = buildTranslationCache(previousData);

  const { uploadsPlaylistId, channelId } = await resolveChannel();
  const playlists = await listAllPlaylists(channelId);
  const membership = await buildPlaylistMembership(playlists);
  const videos = await listUploads(uploadsPlaylistId);

  const jaTitles = videos.map((v) => v.title);
  const jaCategories = [...new Set([...membership.values(), "未分類"])];
  const translations = await translateAll([...jaTitles, ...jaCategories], translationCache);

  const sounds = videos
    .map((v) => {
      const categoryJa = membership.get(v.videoId) || "未分類";
      return {
        videoId: v.videoId,
        slug: v.videoId,
        title: { ja: v.title, en: translations.get(v.title) },
        category: {
          key: slugifyCategory(categoryJa),
          ja: categoryJa,
          en: translations.get(categoryJa),
        },
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        thumbnail: v.thumbnail,
        publishedAt: v.publishedAt,
      };
    })
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  await writeOutputs(sounds);
  console.log(`Synced ${sounds.length} sounds from @${CHANNEL_HANDLE}.`);
}

export { slugifyCategory, buildSitemap, buildTranslationCache, translateAll };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
