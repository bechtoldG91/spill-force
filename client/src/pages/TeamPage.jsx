import { useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { APP_USER } from '../lib/constants';
import { authFetch } from '../lib/auth';
import { cn } from '../lib/utils';

const ROLE_LABELS = {
  admin: 'Admin',
  treinador: 'Treinador',
  atleta: 'Atleta'
};

const EMPTY_TEAM_FORM = {
  name: '',
  city: '',
  logoDataUrl: '',
  socialLinks: {
    instagram: '',
    website: '',
    facebook: '',
    x: ''
  }
};

const EMPTY_EVENT_FORM = {
  title: '',
  startsAt: '',
  location: ''
};

const TEAM_NEWS_LIMIT = 6;
const MAX_COVER_PHOTO_BYTES = 2 * 1024 * 1024;
const COVER_PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function roleLabel(role) {
  return ROLE_LABELS[role] || role || 'Membro';
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

function formatEventDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Data a definir';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function createClientId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `event-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

function teamNewsTags(team) {
  if (!team?.name || team.loading) {
    return [];
  }

  return [team.name, team.city, 'futebol americano'].filter(Boolean);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Nao foi possivel carregar a imagem.'));
    reader.readAsDataURL(file);
  });
}

function TeamLogo({ team, className = 'h-16 w-16', roundedClassName = 'rounded-2xl' }) {
  return (
    <div className={cn('grid shrink-0 place-items-center overflow-hidden bg-tactical-pitch text-white shadow-glow', roundedClassName, className)}>
      {team?.logoDataUrl ? (
        <img src={team.logoDataUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <Icon name="team" className="h-8 w-8" />
      )}
    </div>
  );
}

function initialTeams(authUser) {
  if (authUser) {
    return (authUser.teamMemberships || []).map((membership) => ({
      id: membership.teamId,
      name: membership.teamId,
      city: '',
      logoDataUrl: '',
      coverDataUrl: '',
      upcomingEvents: [],
      socialLinks: {},
      role: membership.role,
      members: [],
      loading: true
    }));
  }

  return APP_USER.teams.map((team) => ({
    id: team.id,
    name: team.name,
    city: '',
    logoDataUrl: '',
    coverDataUrl: '',
    upcomingEvents: [],
    socialLinks: {},
    role: team.role,
    note: team.note,
    members: [
      {
        id: APP_USER.email,
        name: APP_USER.name,
        email: APP_USER.email,
        initials: APP_USER.initials,
        role: APP_USER.role
      }
    ],
    loading: false
  }));
}

export function TeamPage({ authUser, showToast, onAuthRefresh }) {
  const [teams, setTeams] = useState(() => initialTeams(authUser));
  const [teamForm, setTeamForm] = useState(EMPTY_TEAM_FORM);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [teamNews, setTeamNews] = useState([]);
  const [teamNewsLoading, setTeamNewsLoading] = useState(false);
  const [teamNewsLoaded, setTeamNewsLoaded] = useState(false);
  const [savingCover, setSavingCover] = useState(false);
  const [savingLogo, setSavingLogo] = useState(false);
  const [eventForm, setEventForm] = useState(EMPTY_EVENT_FORM);
  const [savingEvents, setSavingEvents] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function loadTeams() {
      if (!authUser?.teamMemberships?.length) {
        setTeams(initialTeams(authUser));
        return;
      }

      setTeams(initialTeams(authUser));

      try {
        const loadedTeams = await Promise.all(
          authUser.teamMemberships.map(async (membership) => {
            const [teamResponse, membersResponse] = await Promise.all([
              authFetch(`/api/teams/${encodeURIComponent(membership.teamId)}`),
              authFetch(`/api/teams/${encodeURIComponent(membership.teamId)}/members`)
            ]);

            const teamPayload = await teamResponse.json().catch(() => ({}));
            const membersPayload = await membersResponse.json().catch(() => ({}));

            if (!teamResponse.ok || !membersResponse.ok) {
              throw new Error(teamPayload.error || membersPayload.error || 'Nao foi possivel carregar o time.');
            }

            return {
              id: membership.teamId,
              name: teamPayload.team?.name || membership.teamId,
              city: teamPayload.team?.city || '',
              logoDataUrl: teamPayload.team?.logoDataUrl || '',
              coverDataUrl: teamPayload.team?.coverDataUrl || '',
              upcomingEvents: teamPayload.team?.upcomingEvents || [],
              socialLinks: teamPayload.team?.socialLinks || {},
              role: membership.role,
              ownerIds: teamPayload.team?.ownerIds || [],
              members: membersPayload.members || [],
              loading: false
            };
          })
        );

        if (!ignore) {
          setTeams(loadedTeams);
        }
      } catch (error) {
        if (!ignore) {
          showToast(error.message);
          setTeams((current) => current.map((team) => ({ ...team, loading: false })));
        }
      }
    }

    loadTeams();
    return () => {
      ignore = true;
    };
  }, [authUser, showToast]);

  const activeTeam = teams[0] || null;
  const upcomingEvents = activeTeam?.upcomingEvents || [];
  const canCreateTeam = Boolean(authUser?.globalAdmin) && teams.length === 0;
  const canManageActiveTeam = Boolean(activeTeam && (authUser?.globalAdmin || activeTeam.role === 'admin'));
  const canEditEvents = Boolean(activeTeam && (authUser?.globalAdmin || activeTeam.role === 'admin' || activeTeam.role === 'treinador'));
  const activeMembers = activeTeam?.members || [];

  useEffect(() => {
    let ignore = false;

    async function loadTeamNews() {
      const tags = teamNewsTags(activeTeam);
      if (!tags.length) {
        setTeamNews([]);
        setTeamNewsLoaded(false);
        return;
      }

      setTeamNewsLoading(true);
      try {
        const response = await authFetch(`/api/news?tags=${encodeURIComponent(tags.join(','))}`);
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload.error || 'Nao foi possivel buscar noticias do time.');
        }

        if (!ignore) {
          setTeamNews((payload.news || []).slice(0, TEAM_NEWS_LIMIT));
          setTeamNewsLoaded(true);
        }
      } catch (error) {
        if (!ignore) {
          setTeamNews([]);
          setTeamNewsLoaded(true);
          showToast(error.message);
        }
      } finally {
        if (!ignore) {
          setTeamNewsLoading(false);
        }
      }
    }

    loadTeamNews();
    return () => {
      ignore = true;
    };
  }, [activeTeam?.id, activeTeam?.name, activeTeam?.city, activeTeam?.loading, showToast]);

  function updateTeamField(field, value) {
    setTeamForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateSocialLink(field, value) {
    setTeamForm((current) => ({
      ...current,
      socialLinks: {
        ...current.socialLinks,
        [field]: value
      }
    }));
  }

  function updateEventField(field, value) {
    setEventForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function mergeUpdatedTeam(updatedTeam) {
    setTeams((current) =>
      current.map((team) =>
        team.id === activeTeam.id
          ? {
              ...team,
              ...updatedTeam,
              role: team.role,
              members: team.members,
              loading: false
            }
          : team
      )
    );
  }

  function handleLogoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) {
      updateTeamField('logoDataUrl', '');
      return;
    }

    if (!file.type.startsWith('image/')) {
      showToast('Selecione uma imagem valida para o logo.');
      event.target.value = '';
      return;
    }

    if (file.size > 700 * 1024) {
      showToast('Use um logo com ate 700 KB.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => updateTeamField('logoDataUrl', String(reader.result || ''));
    reader.onerror = () => showToast('Nao foi possivel carregar o logo.');
    reader.readAsDataURL(file);
  }

  async function saveCoverPhoto(coverDataUrl, successMessage) {
    if (!activeTeam?.id) {
      return;
    }

    setSavingCover(true);
    try {
      const response = await authFetch(`/api/teams/${encodeURIComponent(activeTeam.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ coverDataUrl })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel salvar a foto de fundo.');
      }

      mergeUpdatedTeam(payload.team);
      showToast(successMessage);
    } catch (error) {
      showToast(error.message);
    } finally {
      setSavingCover(false);
    }
  }

  async function saveClubLogo(logoDataUrl, successMessage) {
    if (!activeTeam?.id) {
      return;
    }

    setSavingLogo(true);
    try {
      const response = await authFetch(`/api/teams/${encodeURIComponent(activeTeam.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ logoDataUrl })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel salvar a foto do clube.');
      }

      mergeUpdatedTeam(payload.team);
      showToast(successMessage);
    } catch (error) {
      showToast(error.message);
    } finally {
      setSavingLogo(false);
    }
  }

  async function handleClubLogoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      showToast('Selecione uma imagem valida para o logo.');
      event.target.value = '';
      return;
    }

    if (file.size > 700 * 1024) {
      showToast('Use um logo com ate 700 KB.');
      event.target.value = '';
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      await saveClubLogo(dataUrl, 'Foto do clube atualizada.');
    } catch (error) {
      showToast(error.message);
    } finally {
      event.target.value = '';
    }
  }

  async function handleCoverUpload(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!COVER_PHOTO_TYPES.has(file.type)) {
      showToast('Use uma imagem PNG, JPG ou WebP.');
      event.target.value = '';
      return;
    }

    if (file.size > MAX_COVER_PHOTO_BYTES) {
      showToast('Use uma foto de fundo com ate 2 MB.');
      event.target.value = '';
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      await saveCoverPhoto(dataUrl, 'Foto de fundo atualizada.');
    } catch (error) {
      showToast(error.message);
    } finally {
      event.target.value = '';
    }
  }

  async function saveTeamEvents(nextEvents, successMessage) {
    if (!activeTeam?.id) {
      return;
    }

    setSavingEvents(true);
    try {
      const response = await authFetch(`/api/teams/${encodeURIComponent(activeTeam.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ upcomingEvents: nextEvents })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel salvar os eventos.');
      }

      mergeUpdatedTeam(payload.team);
      showToast(successMessage);
      return true;
    } catch (error) {
      showToast(error.message);
      return false;
    } finally {
      setSavingEvents(false);
    }
  }

  async function addEvent(event) {
    event.preventDefault();

    const title = eventForm.title.trim();
    if (!title) {
      showToast('Informe o nome do evento.');
      return;
    }

    const nextEvents = [
      ...upcomingEvents,
      {
        id: createClientId(),
        title,
        startsAt: eventForm.startsAt,
        location: eventForm.location.trim()
      }
    ];

    const saved = await saveTeamEvents(nextEvents, 'Evento adicionado.');
    if (saved) {
      setEventForm(EMPTY_EVENT_FORM);
    }
  }

  async function removeEvent(eventId) {
    await saveTeamEvents(upcomingEvents.filter((event) => event.id !== eventId), 'Evento removido.');
  }

  async function createTeam(event) {
    event.preventDefault();

    const name = teamForm.name.trim();
    if (!name) {
      showToast('Informe o nome do time.');
      return;
    }

    setCreatingTeam(true);
    try {
      const response = await authFetch('/api/teams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          city: teamForm.city,
          logoDataUrl: teamForm.logoDataUrl,
          socialLinks: teamForm.socialLinks,
          ownerIds: [authUser.id]
        })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel criar o time.');
      }

      setTeamForm(EMPTY_TEAM_FORM);
      await onAuthRefresh?.();
      showToast('Time criado.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setCreatingTeam(false);
    }
  }

  return (
    <section className={cn('grid gap-6', canCreateTeam ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : 'xl:grid-cols-1')}>
      <div className="space-y-6">
        <article className="tactical-panel overflow-hidden">
          <div
            className="field-grid relative min-h-[220px] overflow-hidden bg-tactical-ink bg-cover bg-center sm:min-h-[280px]"
            style={
              activeTeam?.coverDataUrl
                ? {
                    backgroundImage: `linear-gradient(180deg, rgba(0, 34, 68, 0.12), rgba(0, 34, 68, 0.64)), url(${activeTeam.coverDataUrl})`
                  }
                : undefined
            }
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(63,143,41,0.28),transparent_28%),linear-gradient(135deg,rgba(0,34,68,0.12),rgba(0,34,68,0.9))]" />
            {canManageActiveTeam ? (
              <div className="absolute right-4 top-4 z-10 flex flex-wrap justify-end gap-2">
                <label className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/95 px-3 text-xs font-black uppercase tracking-[0.14em] text-tactical-ink shadow-xl transition hover:border-tactical-pitch/40 hover:text-tactical-pitch">
                  <Icon name="upload" className="h-4 w-4" />
                  {savingCover ? 'Salvando...' : activeTeam?.coverDataUrl ? 'Trocar fundo' : 'Adicionar fundo'}
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={savingCover}
                    onChange={handleCoverUpload}
                  />
                </label>

                {activeTeam?.coverDataUrl ? (
                  <button
                    type="button"
                    className="min-h-10 rounded-xl border border-white/20 bg-tactical-ink/80 px-3 text-xs font-black uppercase tracking-[0.14em] text-white shadow-xl transition hover:bg-tactical-pitch"
                    disabled={savingCover}
                    onClick={() => saveCoverPhoto('', 'Foto de fundo removida.')}
                  >
                    Remover
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="relative px-5 pb-5 sm:px-7 sm:pb-7">
            <div className="relative z-10 -mt-20 flex flex-col gap-4 sm:-mt-24 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end">
                <div className="relative w-fit shrink-0">
                  <TeamLogo
                    team={activeTeam}
                    className="h-32 w-32 border-4 border-white sm:h-40 sm:w-40"
                    roundedClassName="rounded-full"
                  />
                  {canManageActiveTeam ? (
                    <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-1">
                      <label className="inline-flex min-h-9 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white px-3 text-[0.6rem] font-black uppercase tracking-[0.12em] text-tactical-ink shadow-xl transition hover:text-tactical-pitch">
                        {savingLogo ? 'Salvando...' : 'Trocar'}
                        <input
                          className="sr-only"
                          type="file"
                          accept="image/*"
                          disabled={savingLogo}
                          onChange={handleClubLogoUpload}
                        />
                      </label>
                      {activeTeam?.logoDataUrl ? (
                        <button
                          type="button"
                          className="min-h-9 rounded-full border border-white/40 bg-tactical-ink/85 px-3 text-[0.6rem] font-black uppercase tracking-[0.12em] text-white shadow-xl transition hover:bg-tactical-pitch"
                          disabled={savingLogo}
                          onClick={() => saveClubLogo('', 'Foto do clube removida.')}
                        >
                          Remover
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="min-w-0 pb-1">
                  <span className="block text-[0.68rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Clube</span>
                  <h1 className="mt-1 truncate text-3xl font-black uppercase tracking-[0.08em] text-tactical-ink sm:text-4xl">
                    {activeTeam?.name || 'Sem time'}
                  </h1>
                  <span className="mt-1 block truncate text-sm font-semibold text-tactical-ash">
                    {activeTeam?.city || 'Cidade nao informada'}
                  </span>
                </div>
              </div>
              <div className="w-fit rounded-full bg-tactical-pitch/10 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-tactical-pitch">
                {roleLabel(activeTeam?.role)}
              </div>
            </div>
          </div>
        </article>

        <div className="grid gap-5 xl:grid-cols-[minmax(220px,20%)_minmax(0,1fr)]">
          <aside className="xl:sticky xl:top-28 xl:self-start">
            <article className="tactical-panel px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-tactical-pitch/10 text-tactical-pitch">
                  <Icon name="clock" className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[0.62rem] font-black uppercase tracking-[0.18em] text-tactical-ash">Eventos</span>
                  <h2 className="truncate text-lg font-black text-tactical-ink">Eventos proximos</h2>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                {upcomingEvents.map((event) => (
                  <div key={event.id} className="rounded-xl border border-tactical-line/35 bg-tactical-bone/35 px-3 py-3">
                    <strong className="block text-sm font-black leading-5 text-tactical-ink">{event.title}</strong>
                    <span className="mt-1 block text-xs font-black uppercase tracking-[0.14em] text-tactical-ash">
                      {formatEventDate(event.startsAt)}
                    </span>
                    {event.location ? (
                      <span className="mt-1 block text-xs font-semibold text-tactical-ash">{event.location}</span>
                    ) : null}
                    {canEditEvents ? (
                      <button
                        type="button"
                        className="mt-3 rounded-lg border border-tactical-ink/10 px-2.5 py-1.5 text-[0.62rem] font-black uppercase tracking-[0.14em] text-tactical-ash transition hover:border-tactical-pitch/35 hover:text-tactical-pitch"
                        disabled={savingEvents}
                        onClick={() => removeEvent(event.id)}
                      >
                        Remover
                      </button>
                    ) : null}
                  </div>
                ))}

                {!upcomingEvents.length ? (
                  <div className="rounded-xl border border-dashed border-tactical-ink/15 bg-tactical-bone/35 px-3 py-6 text-sm font-semibold leading-6 text-tactical-ash">
                    Nenhum evento futuro cadastrado.
                  </div>
                ) : null}
              </div>

              {canEditEvents ? (
                <form className="mt-4 grid gap-3 border-t border-tactical-ink/10 pt-4" onSubmit={addEvent}>
                  <label className="block">
                    <span className="tactical-label">Evento</span>
                    <input
                      className="tactical-input"
                      value={eventForm.title}
                      onChange={(event) => updateEventField('title', event.target.value)}
                      maxLength={120}
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="tactical-label">Data</span>
                    <input
                      className="tactical-input"
                      value={eventForm.startsAt}
                      onChange={(event) => updateEventField('startsAt', event.target.value)}
                      type="datetime-local"
                    />
                  </label>
                  <label className="block">
                    <span className="tactical-label">Local</span>
                    <input
                      className="tactical-input"
                      value={eventForm.location}
                      onChange={(event) => updateEventField('location', event.target.value)}
                      maxLength={120}
                    />
                  </label>
                  <button type="submit" className="tactical-button w-full" disabled={savingEvents}>
                    {savingEvents ? 'Salvando...' : 'Adicionar'}
                  </button>
                </form>
              ) : null}
            </article>
          </aside>

          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <span className="tactical-label">Feed</span>
                <h2 className="text-2xl font-black tracking-tight text-tactical-ink">Noticias do time</h2>
              </div>
              {activeTeam?.name ? (
                <span className="rounded-full bg-tactical-pitch/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-tactical-pitch">
                  {activeTeam.name}
                </span>
              ) : null}
            </div>

            {teamNewsLoading ? (
              <div className="tactical-panel px-6 py-10 text-sm font-semibold uppercase tracking-[0.18em] text-tactical-ash">
                Pesquisando noticias do time...
              </div>
            ) : null}

            {!activeTeam && !teamNewsLoading ? (
              <div className="tactical-panel px-6 py-10 text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-tactical-pitch/10 text-tactical-pitch">
                  <Icon name="news" className="h-7 w-7" />
                </div>
                <strong className="mt-4 block text-sm font-black uppercase tracking-[0.16em] text-tactical-ink">
                  Nenhum clube vinculado
                </strong>
              </div>
            ) : null}

            {!teamNewsLoading && teamNewsLoaded && teamNews.length === 0 ? (
              <div className="tactical-panel px-6 py-10 text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-tactical-pitch/10 text-tactical-pitch">
                  <Icon name="news" className="h-7 w-7" />
                </div>
                <strong className="mt-4 block text-sm font-black uppercase tracking-[0.16em] text-tactical-ink">
                  Nenhuma noticia encontrada
                </strong>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-tactical-ash">
                  O feed usa o nome e a cidade do clube para buscar noticias.
                </p>
              </div>
            ) : null}

            <div className="grid gap-4">
              {teamNews.map((item) => (
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
                  <h3 className="mt-2 text-xl font-black leading-tight text-tactical-ink">{item.title}</h3>
                  {item.summary ? <p className="mt-3 text-sm leading-6 text-tactical-ash">{item.summary}</p> : null}
                </a>
              ))}
            </div>
          </section>
        </div>

        {activeTeam ? (
          <section className="tactical-panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-tactical-ink/10 px-5 py-4">
              <div>
                <span className="tactical-label mb-1">Elenco</span>
                <h2 className="text-2xl font-black tracking-tight text-tactical-ink">Membros do clube</h2>
              </div>
              <span className="rounded-full bg-tactical-pitch/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-tactical-pitch">
                {activeTeam.loading ? 'Carregando' : `${activeMembers.length} membros`}
              </span>
            </div>

            <div className="grid gap-2 px-5 py-5">
              {activeMembers.map((member) => (
                <div
                  key={member.id}
                  className="grid min-h-14 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-tactical-line/35 bg-tactical-bone/45 px-3"
                >
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-tactical-ink text-xs font-black text-white">
                    {member.initials || member.name?.slice(0, 2).toUpperCase() || 'U'}
                  </div>
                  <div className="min-w-0">
                    <strong className="block truncate text-sm font-black text-tactical-ink">{member.name}</strong>
                    <span className="block truncate text-xs font-semibold text-tactical-ash">{member.email}</span>
                  </div>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[0.58rem] font-black uppercase tracking-[0.12em]',
                      member.role === 'admin' ? 'bg-tactical-pitch text-white' : 'bg-white text-tactical-ink'
                    )}
                  >
                    {roleLabel(member.role)}
                  </span>
                </div>
              ))}

              {!activeMembers.length && !activeTeam.loading ? (
                <div className="rounded-xl border border-dashed border-tactical-ink/15 px-4 py-8 text-center">
                  <strong className="text-sm font-black uppercase tracking-[0.16em] text-tactical-ink">Sem membros carregados</strong>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      <aside className="space-y-5 self-start">
        {canCreateTeam ? (
          <form className="tactical-panel px-5 py-5" onSubmit={createTeam}>
            <span className="tactical-label">Novo time</span>
            <h2 className="text-xl font-black tracking-tight text-tactical-ink">Criar clube</h2>

            <div className="mt-4 flex items-center gap-3 rounded-xl border border-tactical-line/35 bg-tactical-bone/55 px-3 py-3">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-tactical-ink/10 bg-white text-tactical-pitch">
                {teamForm.logoDataUrl ? (
                  <img src={teamForm.logoDataUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Icon name="team" className="h-7 w-7" />
                )}
              </div>
              <label className="min-w-0 flex-1">
                <span className="tactical-label">Logo do time</span>
                <input className="block w-full text-xs font-semibold text-tactical-ash" type="file" accept="image/*" onChange={handleLogoUpload} />
              </label>
            </div>

            <label className="mt-4 block">
              <span className="tactical-label">Nome do time</span>
              <input
                className="tactical-input"
                value={teamForm.name}
                onChange={(event) => updateTeamField('name', event.target.value)}
                maxLength={120}
                required
              />
            </label>

            <label className="mt-4 block">
              <span className="tactical-label">Cidade</span>
              <input
                className="tactical-input"
                value={teamForm.city}
                onChange={(event) => updateTeamField('city', event.target.value)}
                maxLength={120}
              />
            </label>

            <div className="mt-4 grid gap-3">
              <span className="tactical-label mb-0">Midias sociais</span>
              <input
                className="tactical-input"
                value={teamForm.socialLinks.instagram}
                onChange={(event) => updateSocialLink('instagram', event.target.value)}
                placeholder="Instagram"
                maxLength={300}
              />
              <input
                className="tactical-input"
                value={teamForm.socialLinks.website}
                onChange={(event) => updateSocialLink('website', event.target.value)}
                placeholder="Site"
                maxLength={300}
              />
              <input
                className="tactical-input"
                value={teamForm.socialLinks.facebook}
                onChange={(event) => updateSocialLink('facebook', event.target.value)}
                placeholder="Facebook"
                maxLength={300}
              />
              <input
                className="tactical-input"
                value={teamForm.socialLinks.x}
                onChange={(event) => updateSocialLink('x', event.target.value)}
                placeholder="X / Twitter"
                maxLength={300}
              />
            </div>

            <button type="submit" className="tactical-button mt-4 w-full" disabled={creatingTeam}>
              {creatingTeam ? 'Criando...' : 'Criar clube'}
            </button>
          </form>
        ) : null}
      </aside>
    </section>
  );
}
