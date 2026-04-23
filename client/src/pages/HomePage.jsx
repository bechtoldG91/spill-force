import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { APP_USER } from '../lib/constants';
import { formatDate } from '../lib/utils';
import { Icon } from '../components/Icons';

export function HomePage({ showToast }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <section className="mx-auto grid w-full max-w-[1240px] gap-6 xl:grid-cols-[290px_minmax(0,1fr)]">
      <aside className="xl:sticky xl:top-28 xl:self-start">
        <article className="tactical-panel overflow-hidden">
          <div className="flex justify-center border-b border-tactical-ink/10 px-5 py-5">
            <div className="grid h-24 w-24 place-items-center rounded-[1.5rem] border border-tactical-pitch/20 bg-tactical-pitch/5 text-3xl font-black text-tactical-pitch shadow-glow">
              {APP_USER.initials}
            </div>
          </div>

          <div className="space-y-4 px-5 py-5">
            <div className="min-w-0 text-center">
              <h1 className="text-2xl font-black uppercase tracking-[0.12em] text-tactical-ink">{APP_USER.name}</h1>
            </div>

            <div className="grid gap-2 text-sm">
              <div className="rounded-[1.35rem] border border-tactical-ink/8 bg-tactical-bone/45 px-4 py-3">
                <span className="block text-[0.68rem] font-black uppercase tracking-[0.28em] text-tactical-ash">Equipe</span>
                <strong className="mt-1 block text-base font-black uppercase tracking-[0.12em]">{APP_USER.team}</strong>
              </div>
              <div className="rounded-[1.35rem] border border-tactical-ink/8 bg-tactical-bone/45 px-4 py-3">
                <span className="block text-[0.68rem] font-black uppercase tracking-[0.28em] text-tactical-ash">Funcao</span>
                <strong className="mt-1 block text-base font-black uppercase tracking-[0.12em]">{APP_USER.unit}</strong>
              </div>
            </div>
          </div>
        </article>
      </aside>

      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5">
        {loading ? (
          <div className="tactical-panel px-6 py-10 text-sm font-semibold uppercase tracking-[0.18em] text-tactical-ash">
            Carregando feed...
          </div>
        ) : null}

        {!loading && videos.length === 0 ? (
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

        {videos.map((video) => (
          <article key={video.id} className="tactical-panel overflow-hidden">
            <div className="flex items-center gap-3 border-b border-tactical-ink/10 px-5 py-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-tactical-pitch text-sm font-black text-white shadow-glow">
                {APP_USER.initials}
              </div>
              <div className="min-w-0">
                <strong className="block truncate text-sm font-black uppercase tracking-[0.16em] text-tactical-ink">
                  {video.uploader || APP_USER.unit}
                </strong>
                <span className="block truncate text-xs font-semibold uppercase tracking-[0.18em] text-tactical-ash">
                  {formatDate(video.createdAt)}
                </span>
              </div>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="space-y-2">
                <h2 className="text-2xl font-black uppercase tracking-[0.12em] text-tactical-ink">{video.title}</h2>
                <div className="flex flex-wrap gap-3 text-[0.68rem] font-black uppercase tracking-[0.18em] text-tactical-ash">
                  <span>{video.playlistName || 'Geral'}</span>
                  <span>{video.kind || 'video'}</span>
                </div>
                {video.notes ? <p className="pt-1 text-sm leading-6 text-tactical-ash">{video.notes}</p> : null}
              </div>

              <div className="overflow-hidden rounded-[1.6rem] border border-tactical-ink/10 bg-tactical-ink">
                <video src={video.url} controls playsInline preload="metadata" className="aspect-video w-full bg-black object-contain" />
              </div>

              <div className="flex justify-end">
                <Link to={`/biblioteca?video=${video.id}`} className="tactical-button-secondary">
                  <Icon name="play" className="h-4 w-4" />
                  Abrir na biblioteca
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
