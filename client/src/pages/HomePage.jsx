import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { APP_USER } from '../lib/constants';
import { authFetch } from '../lib/auth';
import { formatDate, formatDuration } from '../lib/utils';
import { Icon } from '../components/Icons';
import { UserAvatar } from '../components/UserAvatar';

export function HomePage({ showToast, authUser, clubNotificationsCount = 0, onAuthRefresh }) {
  const currentUser = authUser || APP_USER;
  const [videos, setVideos] = useState([]);
  const [userTeams, setUserTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedPlaylists, setExpandedPlaylists] = useState({});
  const [clubForm, setClubForm] = useState({ name: '', city: '' });
  const [creatingClub, setCreatingClub] = useState(false);

  const playlistFeed = useMemo(() => {
    const groups = new Map();

    videos.forEach((video) => {
      const playlistId = video.playlistId || video.id;
      const createdAt = new Date(video.createdAt || 0).getTime();

      if (!groups.has(playlistId)) {
        groups.set(playlistId, {
          id: playlistId,
          playlistName: video.playlistName || 'Playlist do dia',
          uploader: video.uploader || currentUser.name,
          createdAt: video.createdAt,
          previewVideo: video,
          videos: [video]
        });
        return;
      }

      const current = groups.get(playlistId);
      current.videos.push(video);

      if (createdAt >= new Date(current.createdAt || 0).getTime()) {
        current.createdAt = video.createdAt;
        current.uploader = video.uploader || current.uploader;
        current.previewVideo = video;
      }
    });

    return Array.from(groups.values()).sort(
      (left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()
    );
  }, [currentUser.name, videos]);

  const uploadedByUser = useMemo(
    () => videos.filter((video) => (video.uploader || '').toLowerCase() === currentUser.name.toLowerCase()),
    [currentUser.name, videos]
  );

  const profileStats = useMemo(
    () => [
      {
        label: 'Playlists',
        value: new Set(uploadedByUser.map((video) => video.playlistId || video.id)).size
      },
      {
        label: 'Videos',
        value: uploadedByUser.length
      }
    ],
    [uploadedByUser]
  );

  useEffect(() => {
    let ignore = false;

    async function loadFeed() {
      if (authUser && !authUser.globalAdmin && !(authUser.teamMemberships || []).length) {
        setVideos([]);
        setLoading(false);
        return;
      }

      try {
        const response = await authFetch('/api/videos');
        if (!response.ok) {
          throw new Error('Nao foi possivel carregar o feed.');
        }

        const payload = await response.json();
        if (!ignore) {
          setVideos(payload.videos || []);
        }
      } catch (error) {
        if (!ignore) {
          showToast(error.message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadFeed();
    return () => {
      ignore = true;
    };
  }, [authUser, showToast]);

  useEffect(() => {
    let ignore = false;

    async function loadUserTeams() {
      if (!authUser?.teamMemberships?.length) {
        setUserTeams([]);
        return;
      }

      try {
        const loadedTeams = await Promise.all(
          authUser.teamMemberships.map(async (membership) => {
            const response = await authFetch(`/api/teams/${encodeURIComponent(membership.teamId)}`);
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(payload.error || 'Nao foi possivel carregar os times.');
            }

            return {
              id: membership.teamId,
              role: membership.role,
              ...(payload.team || {})
            };
          })
        );

        if (!ignore) {
          setUserTeams(loadedTeams);
        }
      } catch (error) {
        if (!ignore) {
          showToast(error.message);
          setUserTeams([]);
        }
      }
    }

    loadUserTeams();
    return () => {
      ignore = true;
    };
  }, [authUser, showToast]);

  function togglePlaylistExpansion(playlistId) {
    setExpandedPlaylists((current) => ({
      ...current,
      [playlistId]: !current[playlistId]
    }));
  }

  async function createClub(event) {
    event.preventDefault();

    const name = clubForm.name.trim();
    if (!name) {
      showToast('Informe o nome do clube.');
      return;
    }

    setCreatingClub(true);
    try {
      const response = await authFetch('/api/teams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          city: clubForm.city
        })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel criar o clube.');
      }

      setClubForm({ name: '', city: '' });
      await onAuthRefresh?.();
      showToast('Clube criado.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setCreatingClub(false);
    }
  }

  const displayedTeams = authUser ? userTeams : APP_USER.teams;
  const canCreateClub = Boolean(authUser && !authUser.globalAdmin && !(authUser.teamMemberships || []).length);
  const isAthleteUser = Boolean(
    authUser &&
      !authUser.globalAdmin &&
      (authUser.teamMemberships || []).length &&
      (authUser.teamMemberships || []).every((membership) => membership.role === 'atleta')
  );

  return (
    <section className="mx-auto grid w-full max-w-[1180px] gap-5 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-28 lg:self-start">
        <article className="tactical-panel relative pt-20">
          <div className="absolute left-1/2 top-3 -translate-x-1/2 -translate-y-[18%]">
            <UserAvatar user={currentUser} className="h-28 w-28 border-4 border-white text-3xl" />
          </div>

          <div className="space-y-4 px-5 pb-5 pt-12 text-center">
            <div className="min-w-0 text-center">
              <h1 className="text-2xl font-black tracking-tight text-tactical-ink">{currentUser.name}</h1>
            </div>
          </div>

          {!isAthleteUser ? (
            <div className="grid grid-cols-2 border-t border-tactical-ink/10">
              {profileStats.map((stat) => (
                <div key={stat.label} className="px-3 py-4 text-center">
                  <strong className="block text-2xl font-black text-tactical-ink">{stat.value}</strong>
                  <span className="mt-1 block text-sm text-tactical-ash">{stat.label}</span>
                </div>
              ))}
            </div>
          ) : null}
        </article>

        <article className="tactical-panel mt-4 px-5 py-5">
          <h2 className="text-xl font-black tracking-tight text-tactical-ink">Seus times</h2>

          <div className="mt-4 space-y-4">
            {displayedTeams.map((team) => (
              <div key={team.id} className="flex items-center gap-3">
                <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-tactical-pitch/15 bg-tactical-bone text-lg font-black text-tactical-pitch">
                  {team.logoDataUrl ? (
                    <img src={team.logoDataUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    team.name.slice(0, 1)
                  )}
                </div>
                <div className="min-w-0">
                  <strong className="block truncate text-base font-black text-tactical-ink">{team.name}</strong>
                  <span className="block truncate text-sm text-tactical-ash">{team.city || team.role}</span>
                  <span className="block truncate text-xs font-semibold uppercase tracking-[0.14em] text-tactical-ash/80">
                    {team.role || team.note}
                  </span>
                </div>
              </div>
            ))}

            {isAthleteUser && displayedTeams.length ? (
              <div className="grid grid-cols-2 border-t border-tactical-ink/10 pt-4">
                {profileStats.map((stat) => (
                  <div key={stat.label} className="text-center">
                    <strong className="block text-2xl font-black text-tactical-ink">{stat.value}</strong>
                    <span className="mt-1 block text-sm text-tactical-ash">{stat.label}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {!displayedTeams.length ? (
              <div className="rounded-xl border border-dashed border-tactical-ink/15 px-4 py-6 text-center">
                <strong className="text-xs font-black uppercase tracking-[0.16em] text-tactical-ash">
                  Nenhum time vinculado
                </strong>
              </div>
            ) : null}
          </div>
        </article>

        {canCreateClub ? (
          <form className="tactical-panel mt-4 px-5 py-5" onSubmit={createClub}>
            <span className="tactical-label">Novo clube</span>
            <h2 className="text-xl font-black tracking-tight text-tactical-ink">Criar clube</h2>
            <div className="mt-4 grid gap-3">
              <label className="block">
                <span className="tactical-label">Nome</span>
                <input
                  className="tactical-input"
                  value={clubForm.name}
                  onChange={(event) => setClubForm((current) => ({ ...current, name: event.target.value }))}
                  maxLength={120}
                  required
                />
              </label>
              <label className="block">
                <span className="tactical-label">Cidade</span>
                <input
                  className="tactical-input"
                  value={clubForm.city}
                  onChange={(event) => setClubForm((current) => ({ ...current, city: event.target.value }))}
                  maxLength={120}
                />
              </label>
              <button type="submit" className="tactical-button w-full" disabled={creatingClub}>
                {creatingClub ? 'Criando...' : 'Criar clube'}
              </button>
            </div>
          </form>
        ) : null}
      </aside>

      <div className="flex w-full min-w-0 flex-col gap-5">
        {clubNotificationsCount > 0 ? (
          <Link
            to="/club-manage"
            className="tactical-panel flex flex-col gap-4 border-tactical-pitch/25 px-5 py-5 transition hover:border-tactical-pitch/50 hover:bg-tactical-pitch/5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <span className="tactical-label mb-1 text-tactical-pitch">Solicitacoes pendentes</span>
              <strong className="block text-xl font-black tracking-tight text-tactical-ink">
                {clubNotificationsCount} {clubNotificationsCount === 1 ? 'item precisa' : 'itens precisam'} de avaliacao
              </strong>
            </div>
            <span className="inline-flex min-h-11 items-center justify-center rounded-xl bg-tactical-ink px-4 text-xs font-black uppercase tracking-[0.14em] text-white">
              Abrir configuracoes
            </span>
          </Link>
        ) : null}

        {canCreateClub ? (
          <div className="tactical-panel px-6 py-10 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-tactical-pitch/10 text-tactical-pitch">
              <Icon name="team" className="h-7 w-7" />
            </div>
            <strong className="mt-4 block text-lg font-black uppercase tracking-[0.14em] text-tactical-ink">
              Crie seu clube ou solicite entrada
            </strong>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-tactical-ash">
              Use o formulario ao lado para criar um clube novo, ou acesse Clube para procurar um clube existente.
            </p>
            <Link
              to="/time"
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-tactical-ink/10 px-4 text-xs font-black uppercase tracking-[0.14em] text-tactical-ink transition hover:border-tactical-pitch/35 hover:bg-tactical-pitch/10"
            >
              Procurar clube
            </Link>
          </div>
        ) : null}

        {loading ? (
          <div className="tactical-panel px-6 py-10 text-sm font-semibold uppercase tracking-[0.18em] text-tactical-ash">
            Carregando feed...
          </div>
        ) : null}

        {!loading && playlistFeed.length === 0 && !canCreateClub ? (
          <div className="tactical-panel px-6 py-10 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-tactical-pitch/10 text-tactical-pitch">
              <Icon name="film" className="h-7 w-7" />
            </div>
            <strong className="mt-4 block text-lg font-black uppercase tracking-[0.14em] text-tactical-ink">
              Nenhum upload ainda
            </strong>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-tactical-ash">
              Quando alguem do time publicar um video, ele aparece aqui no feed.
            </p>
          </div>
        ) : null}

        {playlistFeed.map((entry) => (
          <article key={entry.id} className="tactical-panel px-5 py-5">
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <UserAvatar user={currentUser} className="h-14 w-14 rounded-xl text-sm" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.68rem] font-black uppercase tracking-[0.18em] text-tactical-ash">
                    <strong className="text-tactical-ink">{entry.uploader || APP_USER.unit}</strong>
                    <span>{formatDate(entry.createdAt)}</span>
                  </div>
                  <p className="text-lg font-black leading-8 text-tactical-ink">
                    Subiu {entry.videos.length} {entry.videos.length === 1 ? 'video' : 'videos'} para a playlist "{entry.playlistName}"
                  </p>
                  <div className="flex flex-wrap gap-3 text-[0.68rem] font-black uppercase tracking-[0.18em] text-tactical-ash">
                    <span>{entry.videos.length} {entry.videos.length === 1 ? 'video adicionado' : 'videos adicionados'}</span>
                    <span>{entry.previewVideo?.kind || 'video'}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {(expandedPlaylists[entry.id] ? entry.videos : entry.videos.slice(0, 3)).map((video) => (
                  <Link
                    key={video.id}
                    to={`/analise?video=${video.id}`}
                    className="group flex flex-col gap-3 rounded-[1.15rem] border border-tactical-ink/10 bg-white px-3 py-3 transition hover:border-tactical-pitch/30 hover:bg-tactical-bone/35 sm:flex-row sm:items-center sm:gap-4"
                    aria-label={`Abrir ${video.title} na analise`}
                  >
                    <div className="relative w-full shrink-0 overflow-hidden rounded-xl border border-tactical-ink/10 bg-tactical-ink sm:w-36">
                      <video src={video.url} muted playsInline preload="metadata" className="aspect-video w-full bg-black object-cover" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-base font-black tracking-tight text-tactical-ink md:text-lg">{video.title}</strong>
                      <div className="mt-1 flex flex-wrap gap-2 text-sm text-tactical-ash">
                        <span>{video.playlistName || 'Playlist do dia'}</span>
                        <span>•</span>
                        <span>{formatDate(video.createdAt)}</span>
                        <span>•</span>
                        <span>{formatDuration(video.duration)}</span>
                      </div>
                    </div>

                    <div className="shrink-0 text-tactical-ash transition group-hover:text-tactical-pitch">
                      <Icon name="play" className="h-4 w-4" />
                    </div>
                  </Link>
                ))}

                {entry.videos.length > 3 ? (
                  <div className="flex justify-center pt-1">
                    <button
                      type="button"
                      onClick={() => togglePlaylistExpansion(entry.id)}
                      className="rounded-lg bg-tactical-bone px-4 py-2 text-sm font-semibold text-tactical-ash transition hover:bg-tactical-pitch/10 hover:text-tactical-pitch"
                    >
                      {expandedPlaylists[entry.id] ? 'Mostrar menos' : `Mais ${entry.videos.length - 3}`}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
