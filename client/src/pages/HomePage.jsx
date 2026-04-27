import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { APP_USER } from '../lib/constants';
import { formatDate, formatDuration } from '../lib/utils';
import { Icon } from '../components/Icons';

export function HomePage({ showToast }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedPlaylists, setExpandedPlaylists] = useState({});

  const playlistFeed = useMemo(() => {
    const groups = new Map();

    videos.forEach((video) => {
      const playlistId = video.playlistId || video.id;
      const createdAt = new Date(video.createdAt || 0).getTime();

      if (!groups.has(playlistId)) {
        groups.set(playlistId, {
          id: playlistId,
          playlistName: video.playlistName || 'Playlist do dia',
          uploader: video.uploader || APP_USER.name,
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
  }, [videos]);

  const uploadedByUser = useMemo(
    () => videos.filter((video) => (video.uploader || '').toLowerCase() === APP_USER.name.toLowerCase()),
    [videos]
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
      },
      {
        label: 'Times',
        value: APP_USER.teams.length
      }
    ],
    [uploadedByUser]
  );

  useEffect(() => {
    let ignore = false;

    async function loadFeed() {
      try {
        const response = await fetch('/api/videos');
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
  }, [showToast]);

  function togglePlaylistExpansion(playlistId) {
    setExpandedPlaylists((current) => ({
      ...current,
      [playlistId]: !current[playlistId]
    }));
  }

  return (
    <section className="mx-auto grid w-full max-w-[1240px] gap-6 xl:grid-cols-[290px_minmax(0,1fr)]">
      <aside className="xl:sticky xl:top-28 xl:self-start">
        <article className="tactical-panel relative pt-20">
          <div className="absolute left-1/2 top-3 -translate-x-1/2 -translate-y-[18%]">
            <div className="grid h-28 w-28 place-items-center rounded-full border-4 border-white bg-tactical-pitch/10 text-3xl font-black text-tactical-pitch shadow-xl">
              {APP_USER.initials}
            </div>
          </div>

          <div className="space-y-4 px-5 pb-5 pt-12 text-center">
            <div className="min-w-0 text-center">
              <h1 className="text-2xl font-black tracking-tight text-tactical-ink">{APP_USER.name}</h1>
              <button type="button" className="mt-1 text-sm font-medium text-tactical-ash transition hover:text-tactical-pitch">
                Ver perfil
              </button>
            </div>

            <p className="mx-auto max-w-[220px] text-sm leading-6 text-tactical-ash">{APP_USER.summary}</p>
          </div>

          <div className="grid grid-cols-3 border-t border-tactical-ink/10">
            {profileStats.map((stat) => (
              <div key={stat.label} className="px-3 py-4 text-center">
                <strong className="block text-2xl font-black text-tactical-ink">{stat.value}</strong>
                <span className="mt-1 block text-sm text-tactical-ash">{stat.label}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="tactical-panel mt-4 px-5 py-5">
          <h2 className="text-xl font-black tracking-tight text-tactical-ink">Seus times</h2>

          <div className="mt-4 space-y-4">
            {APP_USER.teams.map((team) => (
              <div key={team.id} className="flex items-center gap-3">
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-tactical-pitch/15 bg-tactical-bone text-lg font-black text-tactical-pitch">
                  {team.name.slice(0, 1)}
                </div>
                <div className="min-w-0">
                  <strong className="block truncate text-base font-black text-tactical-ink">{team.name}</strong>
                  <span className="block truncate text-sm text-tactical-ash">{team.role}</span>
                  <span className="block truncate text-xs font-semibold uppercase tracking-[0.14em] text-tactical-ash/80">
                    {team.note}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </article>
      </aside>

      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5">
        {loading ? (
          <div className="tactical-panel px-6 py-10 text-sm font-semibold uppercase tracking-[0.18em] text-tactical-ash">
            Carregando feed...
          </div>
        ) : null}

        {!loading && playlistFeed.length === 0 ? (
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
          <article key={entry.id} className="tactical-panel overflow-hidden">
            <div className="flex items-center gap-3 border-b border-tactical-ink/10 px-5 py-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-tactical-pitch text-sm font-black text-white shadow-glow">
                {APP_USER.initials}
              </div>
              <div className="min-w-0">
                <strong className="block truncate text-sm font-black uppercase tracking-[0.16em] text-tactical-ink">
                  {entry.uploader || APP_USER.unit}
                </strong>
                <span className="block truncate text-xs font-semibold uppercase tracking-[0.18em] text-tactical-ash">
                  {formatDate(entry.createdAt)}
                </span>
              </div>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="space-y-2">
                <p className="text-lg font-black leading-8 text-tactical-ink">
                  {entry.uploader || APP_USER.name} subiu a playlist "{entry.playlistName}"
                </p>
                <div className="flex flex-wrap gap-3 text-[0.68rem] font-black uppercase tracking-[0.18em] text-tactical-ash">
                  <span>{entry.videos.length} {entry.videos.length === 1 ? 'video adicionado' : 'videos adicionados'}</span>
                  <span>{entry.previewVideo?.kind || 'video'}</span>
                </div>
              </div>

              <div className="space-y-3">
                {(expandedPlaylists[entry.id] ? entry.videos : entry.videos.slice(0, 3)).map((video) => (
                  <Link
                    key={video.id}
                    to={`/analise?video=${video.id}`}
                    className="group flex items-center gap-4 rounded-[1.15rem] border border-tactical-ink/10 bg-white px-3 py-3 transition hover:border-tactical-pitch/30 hover:bg-tactical-bone/35"
                    aria-label={`Abrir ${video.title} na analise`}
                  >
                    <div className="relative w-36 shrink-0 overflow-hidden rounded-xl border border-tactical-ink/10 bg-tactical-ink">
                      <video src={video.url} muted playsInline preload="metadata" className="aspect-video w-full bg-black object-cover" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-lg font-black tracking-tight text-tactical-ink">{video.title}</strong>
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
