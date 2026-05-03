const {
  storageService,
  jsonResponse,
  safeText,
  readJsonBody
} = require('./storage');
const { getRequestIdentity } = require('./auth');

const CURRENT_USER_EMAIL = 'gbechtold91@gmail.com';
const NEWS_MAX_TAGS = 8;
const DEFAULT_NEWS_TAGS = ['futebol americano', 'brasil'];

function sanitizeNewsTags(rawTags) {
  const tags = [];
  const seen = new Set();

  (Array.isArray(rawTags) ? rawTags : []).forEach((rawTag) => {
    const tag = safeText(rawTag, 60);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) {
      return;
    }
    seen.add(key);
    tags.push(tag);
  });

  return tags.slice(0, NEWS_MAX_TAGS);
}

function normalizeAccountPreferences(preferences = {}) {
  return {
    newsTags: sanitizeNewsTags(preferences.newsTags),
    newsTagsConfiguredAt: safeText(preferences.newsTagsConfiguredAt, 40)
  };
}

function getAccountUser(store, email = CURRENT_USER_EMAIL) {
  const users = store && typeof store === 'object' && store.users && typeof store.users === 'object' ? store.users : {};
  const normalizedEmail = safeText(email, 160).toLowerCase() || CURRENT_USER_EMAIL;
  const user = users[normalizedEmail] && typeof users[normalizedEmail] === 'object' ? users[normalizedEmail] : {};

  return {
    email: normalizedEmail,
    preferences: normalizeAccountPreferences(user.preferences)
  };
}

async function handleGetAccountPreferences(req, res) {
  const identity = await getRequestIdentity(req);
  const account = await storageService.transaction((repository) => repository.getAccount());
  const user = getAccountUser(account, identity.email);

  jsonResponse(res, 200, {
    user: {
      email: user.email,
      preferences: user.preferences
    },
    defaults: {
      newsTags: DEFAULT_NEWS_TAGS
    }
  });
}

async function handleUpdateAccountPreferences(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Preferencias maiores que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const identity = await getRequestIdentity(req);
  const newsTags = sanitizeNewsTags(payload.newsTags);
  if (newsTags.length === 0) {
    jsonResponse(res, 400, { error: 'Informe pelo menos uma tag de noticias.' });
    return;
  }

  const user = await storageService.transaction(async (repository) => {
    const nextAccount = await repository.updateAccount((account) => {
      const users = account.users && typeof account.users === 'object' ? account.users : {};
      const current = getAccountUser({ users }, identity.email);
      const now = new Date().toISOString();
      const nextUser = {
        ...users[current.email],
        email: current.email,
        preferences: {
          ...current.preferences,
          newsTags,
          newsTagsConfiguredAt: current.preferences.newsTagsConfiguredAt || now
        },
        updatedAt: now
      };

      const nextAccount = {
        ...account,
        users: {
          ...users,
          [current.email]: nextUser
        }
      };

      return nextAccount;
    });

    return getAccountUser(nextAccount);
  });

  jsonResponse(res, 200, {
    user: {
      email: user.email,
      preferences: user.preferences
    }
  });
}

module.exports = {
  DEFAULT_NEWS_TAGS,
  sanitizeNewsTags,
  getAccountUser,
  handleGetAccountPreferences,
  handleUpdateAccountPreferences
};
