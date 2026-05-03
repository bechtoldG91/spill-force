import { useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { APP_USER } from '../lib/constants';
import { authFetch } from '../lib/auth';
import { cn } from '../lib/utils';

const TEST_TAG_STORAGE_KEY = 'spill-force-news-tags-test';
const TAG_OPTIONS = ['futebol americano', 'brasil', 'flag football', 'cbfa', 'nfl', 'superliga', 'eventos', 'resultados'];
const FALLBACK_TAGS = ['futebol americano', 'brasil'];

function normalizeTag(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function uniqueTags(values) {
  const seen = new Set();
  const tags = [];

  values.forEach((value) => {
    const tag = normalizeTag(value);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) {
      return;
    }
    seen.add(key);
    tags.push(tag);
  });

  return tags.slice(0, 8);
}

function formatNewsDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Data indisponivel';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function readTestTags(defaultTags = FALLBACK_TAGS) {
  try {
    const raw = window.localStorage.getItem(TEST_TAG_STORAGE_KEY);
    if (!raw) {
      return { saved: [], selected: uniqueTags(defaultTags) };
    }

    const stored = JSON.parse(raw);
    const tags = uniqueTags(Array.isArray(stored) ? stored : []);
    return { saved: tags, selected: tags.length ? tags : uniqueTags(defaultTags) };
  } catch {
    return { saved: [], selected: uniqueTags(defaultTags) };
  }
}

function saveTestTags(tags) {
  try {
    window.localStorage.setItem(TEST_TAG_STORAGE_KEY, JSON.stringify(tags));
  } catch {
    // Local fallback is best effort only.
  }
}

export function NewsPage({ showToast, authUser }) {
  const currentUser = authUser || APP_USER;
  const [savedTags, setSavedTags] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [draftTag, setDraftTag] = useState('');
  const [news, setNews] = useState([]);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsLoaded, setNewsLoaded] = useState(false);
  const [preferencesMode, setPreferencesMode] = useState('account');

  const preferencesConfigured = savedTags.length > 0;

  useEffect(() => {
    let ignore = false;

    async function loadPreferences() {
      setPreferencesLoading(true);
      try {
        const response = await authFetch('/api/account/preferences');
        const payload = await response.json();

        if (!response.ok) {
          if (response.status === 404) {
            const testTags = readTestTags(payload.defaults?.newsTags);
            setPreferencesMode('test');
            setSavedTags(testTags.saved);
            setSelectedTags(testTags.selected);
            return;
          }
          throw new Error(payload.error || 'Nao foi possivel carregar preferencias.');
        }

        if (ignore) {
          return;
        }

        const accountTags = uniqueTags(payload.user?.preferences?.newsTags || []);
        const defaultTags = uniqueTags(payload.defaults?.newsTags || []);
        setPreferencesMode('account');
        setSavedTags(accountTags);
        setSelectedTags(accountTags.length ? accountTags : defaultTags);
      } catch (error) {
        if (!ignore) {
          showToast(error.message);
        }
      } finally {
        if (!ignore) {
          setPreferencesLoading(false);
        }
      }
    }

    loadPreferences();
    return () => {
      ignore = true;
    };
  }, [showToast]);

  useEffect(() => {
    let ignore = false;

    async function loadNews() {
      if (!preferencesConfigured) {
        setNews([]);
        setNewsLoaded(false);
        return;
      }

      setNewsLoading(true);
      try {
        const response = await authFetch(`/api/news?tags=${encodeURIComponent(savedTags.join(','))}`);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || 'Nao foi possivel buscar noticias.');
        }

        if (!ignore) {
          setNews(payload.news || []);
          setNewsLoaded(true);
        }
      } catch (error) {
        if (!ignore) {
          setNews([]);
          setNewsLoaded(true);
          showToast(error.message);
        }
      } finally {
        if (!ignore) {
          setNewsLoading(false);
        }
      }
    }

    loadNews();
    return () => {
      ignore = true;
    };
  }, [preferencesConfigured, savedTags, showToast]);

  function addTag(value = draftTag) {
    const tag = normalizeTag(value);
    if (!tag) {
      return;
    }

    setSelectedTags((current) => uniqueTags([...current, tag]));
    setDraftTag('');
  }

  function removeTag(tag) {
    setSelectedTags((current) => current.filter((item) => item.toLowerCase() !== tag.toLowerCase()));
  }

  function togglePreset(tag) {
    const exists = selectedTags.some((item) => item.toLowerCase() === tag.toLowerCase());
    if (exists) {
      removeTag(tag);
      return;
    }
    addTag(tag);
  }

  async function savePreferences() {
    const nextTags = uniqueTags(selectedTags);
    if (!nextTags.length) {
      showToast('Informe pelo menos uma tag.');
      return;
    }

    setSavingPreferences(true);
    try {
      const response = await authFetch('/api/account/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ newsTags: nextTags })
      });
      const payload = await response.json();

      if (!response.ok) {
        if (response.status === 404) {
          saveTestTags(nextTags);
          setPreferencesMode('test');
          setSavedTags(nextTags);
          setSelectedTags(nextTags);
          showToast('Tags salvas no modo de teste.');
          return;
        }
        throw new Error(payload.error || 'Nao foi possivel salvar preferencias.');
      }

      const accountTags = uniqueTags(payload.user?.preferences?.newsTags || nextTags);
      setSavedTags(accountTags);
      setSelectedTags(accountTags);
      showToast('Tags salvas na conta.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setSavingPreferences(false);
    }
  }

  function handleTagKeyDown(event) {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    addTag();
  }

  return (
    <section className="mx-auto grid w-full max-w-[1180px] gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-5 xl:sticky xl:top-28 xl:self-start">
        <div className="tactical-panel px-5 py-5">
          {preferencesLoading ? (
            <div className="text-sm font-semibold uppercase tracking-[0.16em] text-tactical-ash">Carregando conta...</div>
          ) : preferencesConfigured ? (
            <div>
              <span className="tactical-label">{preferencesMode === 'test' ? 'Tags de teste' : 'Tags da conta'}</span>
              <div className="flex flex-wrap gap-2">
                {savedTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex min-h-9 items-center rounded-full border border-tactical-pitch/25 bg-tactical-pitch/10 px-3 text-xs font-black uppercase tracking-[0.12em] text-tactical-ink"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-tactical-ink/10 bg-tactical-bone px-4 py-3 text-sm font-semibold leading-6 text-tactical-ash">
                {preferencesMode === 'test'
                  ? 'Modo temporario para testar sem login. Depois, essas tags passam para as configuracoes da conta.'
                  : `Preferencias salvas para ${currentUser.name}. Alteracoes podem ser feitas nas configuracoes.`}
              </div>
            </div>
          ) : (
            <div>
              <label className="block">
                <span className="tactical-label">Configurar noticias</span>
                <div className="flex gap-2">
                  <input
                    className="tactical-input"
                    value={draftTag}
                    onChange={(event) => setDraftTag(event.target.value)}
                    onKeyDown={handleTagKeyDown}
                    placeholder="Ex: futebol americano"
                  />
                  <button type="button" className="tactical-button-secondary min-h-11 px-3" onClick={() => addTag()}>
                    +
                  </button>
                </div>
              </label>

              <div className="mt-4 flex flex-wrap gap-2">
                {selectedTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="inline-flex min-h-9 items-center gap-2 rounded-full border border-tactical-pitch/25 bg-tactical-pitch/10 px-3 text-xs font-black uppercase tracking-[0.12em] text-tactical-ink transition hover:border-red-600/40 hover:bg-red-50 hover:text-red-700"
                    onClick={() => removeTag(tag)}
                    title="Remover tag"
                  >
                    {tag}
                    <span aria-hidden="true">x</span>
                  </button>
                ))}
              </div>

              <div className="mt-5 border-t border-tactical-ink/10 pt-4">
                <span className="tactical-label">Sugestoes</span>
                <div className="flex flex-wrap gap-2">
                  {TAG_OPTIONS.map((tag) => {
                    const active = selectedTags.some((item) => item.toLowerCase() === tag.toLowerCase());
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={cn(
                          'rounded-full border px-3 py-2 text-[0.62rem] font-black uppercase tracking-[0.13em] transition',
                          active
                            ? 'border-tactical-pitch bg-tactical-pitch text-white'
                            : 'border-tactical-ink/10 bg-white text-tactical-ash hover:border-tactical-pitch/35 hover:text-tactical-ink'
                        )}
                        onClick={() => togglePreset(tag)}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button type="button" className="tactical-button mt-5 w-full" onClick={savePreferences} disabled={savingPreferences}>
                {savingPreferences ? 'Salvando...' : 'Salvar na conta'}
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="space-y-5">
        {!preferencesConfigured && !preferencesLoading ? (
          <div className="tactical-panel px-6 py-12 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-tactical-pitch/10 text-tactical-pitch">
              <Icon name="news" className="h-8 w-8" />
            </div>
            <strong className="mt-4 block text-lg font-black uppercase tracking-[0.14em] text-tactical-ink">
              Escolha suas tags uma vez
            </strong>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-tactical-ash">
              Depois disso, o feed usa as preferencias salvas na conta do usuario.
            </p>
          </div>
        ) : null}

        {newsLoading ? (
          <div className="tactical-panel px-6 py-10 text-sm font-semibold uppercase tracking-[0.18em] text-tactical-ash">
            Pesquisando noticias na internet...
          </div>
        ) : null}

        {!newsLoading && newsLoaded && news.length === 0 ? (
          <div className="tactical-panel px-6 py-12 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-tactical-pitch/10 text-tactical-pitch">
              <Icon name="news" className="h-8 w-8" />
            </div>
            <strong className="mt-4 block text-lg font-black uppercase tracking-[0.14em] text-tactical-ink">
              Nenhuma noticia encontrada
            </strong>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-tactical-ash">
              As tags podem ser ajustadas depois nas configuracoes da conta.
            </p>
          </div>
        ) : null}

        <div className="grid gap-4">
          {news.map((item) => (
            <a
              key={item.id}
              href={item.link}
              target="_blank"
              rel="noreferrer"
              className="tactical-panel block px-5 py-5 no-underline transition hover:border-tactical-pitch/45 hover:shadow-glow"
            >
              <div className="flex flex-wrap gap-2 text-[0.62rem] font-black uppercase tracking-[0.16em] text-tactical-ash">
                <span>{item.source}</span>
                <span>{formatNewsDate(item.publishedAt)}</span>
              </div>
              <h2 className="mt-2 text-xl font-black leading-tight text-tactical-ink">{item.title}</h2>
              {item.summary ? <p className="mt-3 text-sm leading-6 text-tactical-ash">{item.summary}</p> : null}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
