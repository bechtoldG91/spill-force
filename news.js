const { storageService, jsonResponse, safeText } = require('./storage');
const { DEFAULT_NEWS_TAGS, sanitizeNewsTags, getAccountUser } = require('./account');
const { getRequestIdentity } = require('./auth');

const NEWS_RSS_ENDPOINT = 'https://news.google.com/rss/search';
const NEWS_FETCH_TIMEOUT_MS = 8000;
const NEWS_MAX_RESULTS = 16;

function decodeXmlText(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

function stripXmlMarkup(value) {
  return decodeXmlText(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readXmlTag(block, tagName) {
  const match = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(block);
  return match ? decodeXmlText(match[1]).trim() : '';
}

function parseNewsTags(requestUrl) {
  const rawTags = [
    ...requestUrl.searchParams.getAll('tag'),
    ...String(requestUrl.searchParams.get('tags') || '').split(',')
  ];

  return sanitizeNewsTags(rawTags);
}

function newsItemId(title, link) {
  return Buffer.from(`${title}|${link}`).toString('base64url').slice(0, 48);
}

function newsTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function parseNewsFeed(xml) {
  const items = String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) || [];

  return items
    .map((item, index) => {
      const title = safeText(readXmlTag(item, 'title'), 220);
      const link = safeText(readXmlTag(item, 'link'), 500);
      const source = safeText(readXmlTag(item, 'source'), 120);
      const publishedAt = safeText(readXmlTag(item, 'pubDate'), 80);
      const summary = safeText(stripXmlMarkup(readXmlTag(item, 'description')), 320);

      if (!title || !link) {
        return null;
      }

      return {
        id: newsItemId(title, link),
        title,
        link,
        source: source || 'Fonte externa',
        publishedAt,
        summary,
        _timestamp: newsTimestamp(publishedAt),
        _index: index
      };
    })
    .filter(Boolean)
    .sort((left, right) => right._timestamp - left._timestamp || left._index - right._index)
    .map(({ _timestamp, _index, ...item }) => item);
}

async function fetchSportsNews(tags) {
  if (typeof fetch !== 'function') {
    throw new Error('FETCH_UNAVAILABLE');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NEWS_FETCH_TIMEOUT_MS);
  const searchUrl = new URL(NEWS_RSS_ENDPOINT);
  const baseQuery = tags.join(' ');
  searchUrl.searchParams.set('q', `${baseQuery} noticias eventos resultados jogos`);
  searchUrl.searchParams.set('hl', 'pt-BR');
  searchUrl.searchParams.set('gl', 'BR');
  searchUrl.searchParams.set('ceid', 'BR:pt-419');

  try {
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'SpillForce/1.0'
      }
    });

    if (!response.ok) {
      throw new Error('NEWS_FETCH_FAILED');
    }

    const xml = await response.text();
    return parseNewsFeed(xml).slice(0, NEWS_MAX_RESULTS);
  } finally {
    clearTimeout(timeout);
  }
}

async function handleSearchNews(req, res, requestUrl) {
  const requestedTags = parseNewsTags(requestUrl);
  const identity = await getRequestIdentity(req);
  const account = await storageService.transaction((repository) => repository.getAccount());
  const accountUser = getAccountUser(account, identity.email);
  const tags = requestedTags.length ? requestedTags : accountUser.preferences.newsTags.length ? accountUser.preferences.newsTags : DEFAULT_NEWS_TAGS;

  try {
    const news = await fetchSportsNews(tags);
    jsonResponse(res, 200, { tags, news });
  } catch (error) {
    jsonResponse(res, 502, {
      error: 'Nao foi possivel buscar noticias agora.',
      tags,
      news: []
    });
  }
}

module.exports = {
  handleSearchNews
};
