import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icons';
import { APP_USER } from '../lib/constants';
import { cn, formatBytes, formatDuration, kindLabel } from '../lib/utils';

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'];

function buildFileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function deriveTitle(file) {
  return file.name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isVideoFile(file) {
  if (String(file?.type || '').startsWith('video/')) {
    return true;
  }

  const fileName = String(file?.name || '').toLowerCase();
  return VIDEO_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}

function getVideoDuration(file) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
    };

    video.preload = 'metadata';
    video.src = objectUrl;
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : null;
      cleanup();
      resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      resolve(null);
    };
  });
}

function uploadFile(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded, event.total);
      }
    };

    request.onload = () => {
      let payload = {};
      try {
        payload = JSON.parse(request.responseText || '{}');
      } catch (error) {
        payload = {};
      }

      if (request.status >= 200 && request.status < 300) {
        resolve(payload);
        return;
      }

      reject(new Error(payload.error || 'Nao foi possivel concluir o upload.'));
    };

    request.onerror = () => reject(new Error('Falha de rede durante o upload.'));
    request.send(file);
  });
}

export function UploadPage({ showToast }) {
  const inputRef = useRef(null);
  const [playlists, setPlaylists] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [form, setForm] = useState({
    title: '',
    playlistId: '',
    kind: 'treino',
    visibility: 'equipe',
    uploader: APP_USER.name
  });

  const totalFiles = selectedFiles.length;
  const totalBytes = useMemo(
    () => selectedFiles.reduce((sum, item) => sum + (item.file.size || 0), 0),
    [selectedFiles]
  );
  const selectedPlaylistName = useMemo(
    () => playlists.find((playlist) => playlist.id === form.playlistId)?.name || 'Selecione',
    [playlists, form.playlistId]
  );
  const overallProgress = useMemo(() => {
    if (!selectedFiles.length) {
      return 0;
    }

    const loaded = selectedFiles.reduce((sum, item) => sum + (item.file.size || 0) * ((item.progress || 0) / 100), 0);
    return Math.round((loaded / Math.max(totalBytes, 1)) * 100);
  }, [selectedFiles, totalBytes]);

  useEffect(() => {
    let ignore = false;

    async function loadPlaylists() {
      const response = await fetch('/api/playlists');
      if (!response.ok) {
        throw new Error('Nao foi possivel carregar as playlists.');
      }

      const payload = await response.json();
      if (!ignore) {
        const nextPlaylists = payload.playlists || [];
        setPlaylists(nextPlaylists);
        setForm((current) => ({
          ...current,
          playlistId: current.playlistId || nextPlaylists[0]?.id || ''
        }));
      }
    }

    loadPlaylists().catch((error) => {
      if (!ignore) {
        showToast(error.message);
      }
    });

    return () => {
      ignore = true;
    };
  }, [showToast]);

  async function appendFiles(fileList) {
    const rawFiles = Array.from(fileList || []);
    if (!rawFiles.length) {
      return;
    }

    const validFiles = rawFiles.filter(isVideoFile);
    const invalidCount = rawFiles.length - validFiles.length;

    if (!validFiles.length) {
      showToast('Selecione arquivos de video validos.');
      return;
    }

    const preparedFiles = await Promise.all(
      validFiles.map(async (file) => ({
        key: buildFileKey(file),
        file,
        title: deriveTitle(file) || 'Video',
        duration: await getVideoDuration(file),
        progress: 0,
        status: 'ready',
        error: ''
      }))
    );

    let addedCount = 0;
    let duplicateCount = 0;

    setSelectedFiles((current) => {
      const knownKeys = new Set(current.map((item) => item.key));
      const next = [...current];

      preparedFiles.forEach((item) => {
        if (knownKeys.has(item.key)) {
          duplicateCount += 1;
          return;
        }

        knownKeys.add(item.key);
        next.push(item);
        addedCount += 1;
      });

      return next;
    });

    if (addedCount) {
      showToast(
        `${addedCount} ${addedCount === 1 ? 'video selecionado' : 'videos selecionados'}${invalidCount ? `, ${invalidCount} ignorados` : ''}${
          duplicateCount ? `, ${duplicateCount} repetidos` : ''
        }.`
      );
    } else if (duplicateCount || invalidCount) {
      showToast(
        `${duplicateCount ? `${duplicateCount} repetidos` : ''}${duplicateCount && invalidCount ? ' e ' : ''}${
          invalidCount ? `${invalidCount} invalidos` : ''
        }.`
      );
    }
  }

  function openFilePicker() {
    inputRef.current?.click();
  }

  function removeSelectedFile(key) {
    if (isUploading) {
      return;
    }

    setSelectedFiles((current) => current.filter((item) => item.key !== key));
  }

  async function handleCreatePlaylist() {
    const name = newPlaylistName.trim();
    if (!name) {
      showToast('Digite o nome da playlist.');
      return;
    }

    setIsCreatingPlaylist(true);

    try {
      const response = await fetch('/api/playlists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel criar a playlist.');
      }

      const playlist = payload.playlist;
      setPlaylists((current) => {
        const existing = current.find((item) => item.id === playlist.id);
        if (existing) {
          return current.map((item) => (item.id === playlist.id ? playlist : item));
        }

        return [...current, playlist];
      });
      setForm((current) => ({
        ...current,
        playlistId: playlist.id
      }));
      setNewPlaylistName('');
      showToast('Playlist pronta.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setIsCreatingPlaylist(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!selectedFiles.length) {
      showToast('Escolha pelo menos um video.');
      return;
    }

    const playlistId = form.playlistId || playlists[0]?.id || '';
    if (!playlistId) {
      showToast('Crie ou selecione uma playlist.');
      return;
    }

    setIsUploading(true);

    const progressMap = Object.fromEntries(
      selectedFiles.map((item) => [
        item.key,
        {
          loaded: 0,
          total: item.file.size || 1
        }
      ])
    );

    const updateProgress = (key, loaded, total) => {
      progressMap[key] = {
        loaded,
        total: total || progressMap[key]?.total || 1
      };

      setSelectedFiles((current) =>
        current.map((item) =>
          item.key === key
            ? {
                ...item,
                progress: Math.max(0, Math.min(100, Math.round((loaded / Math.max(total || item.file.size || 1, 1)) * 100))),
                status: 'uploading',
                error: ''
              }
            : item
        )
      );
    };

    const uploadTargets = selectedFiles.map((item) => {
      const title = selectedFiles.length === 1 ? form.title.trim() || item.title : item.title;
      const params = new URLSearchParams({
        fileName: item.file.name,
        title,
        duration: item.duration ? String(Math.round(item.duration)) : '',
        playlistId,
        kind: form.kind,
        visibility: form.visibility,
        uploader: form.uploader || APP_USER.name
      });

      return uploadFile(`/api/videos?${params.toString()}`, item.file, (loaded, total) => updateProgress(item.key, loaded, total))
        .then((payload) => ({ key: item.key, payload }))
        .catch((error) => {
          throw {
            key: item.key,
            error
          };
        });
    });

    const results = await Promise.allSettled(uploadTargets);
    const successCount = results.filter((result) => result.status === 'fulfilled').length;
    const failedItems = [];

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        const key = result.value.key;
        setSelectedFiles((current) =>
          current.map((item) =>
            item.key === key
              ? {
                  ...item,
                  progress: 100,
                  status: 'done',
                  error: ''
                }
              : item
          )
        );
        return;
      }

      failedItems.push({
        key: result.reason.key,
        message: result.reason.error?.message || 'Falha no upload.'
      });
    });

    const failureCount = failedItems.length;

    if (successCount) {
      try {
        const response = await fetch('/api/playlists');
        if (response.ok) {
          const payload = await response.json();
          setPlaylists(payload.playlists || []);
        }
      } catch (error) {
        // Sem drama: a contagem da playlist pode atualizar na proxima visita.
      }
    }

    if (failureCount) {
      const failedMap = new Map(failedItems.map((item) => [item.key, item.message]));
      setSelectedFiles((current) =>
        current
          .filter((item) => failedMap.has(item.key))
          .map((item) => ({
            ...item,
            progress: 0,
            status: 'error',
            error: failedMap.get(item.key) || 'Falha no upload.'
          }))
      );
    } else {
      setSelectedFiles([]);
      setForm((current) => ({
        ...current,
        title: ''
      }));
    }

    setIsUploading(false);

    if (failureCount && successCount) {
      showToast(`${successCount} videos publicados. ${failureCount} falharam.`);
      return;
    }

    if (failureCount) {
      showToast(failedItems[0]?.message || 'Nenhum upload foi concluido.');
      return;
    }

    showToast(`${successCount} ${successCount === 1 ? 'video publicado' : 'videos publicados'} com sucesso.`);
  }

  return (
    <section className="space-y-6">
      <form id="upload-form" className="space-y-6" onSubmit={handleSubmit}>
        <div className="tactical-dark-panel overflow-hidden px-5 py-5">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
            <input
              ref={inputRef}
              type="file"
              accept="video/*,.mp4,.mov,.webm,.avi,.mkv,.m4v"
              multiple
              className="hidden"
              onChange={async (event) => {
                await appendFiles(event.target.files);
                event.target.value = '';
              }}
            />

            <button
              type="button"
              onClick={openFilePicker}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={async (event) => {
                event.preventDefault();
                setIsDragging(false);
                await appendFiles(event.dataTransfer.files);
              }}
              className={cn(
                'grid min-h-[220px] w-full place-items-center rounded-[1.75rem] border-2 border-dashed px-6 py-8 text-center transition',
                isDragging
                  ? 'border-tactical-pitch bg-white/10'
                  : 'border-white/15 bg-white/5 hover:border-tactical-pitch hover:bg-white/10'
              )}
            >
              <div>
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-tactical-pitch text-white shadow-glow">
                  <Icon name="upload" className="h-7 w-7" />
                </div>
                <strong className="mt-4 block text-lg font-black uppercase tracking-[0.14em] text-white">
                  Soltar videos aqui
                </strong>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/70">
                  Clique para escolher ou arraste varios arquivos ao mesmo tempo.
                </p>
                <span className="mt-4 inline-flex rounded-full border border-white/10 bg-white/10 px-4 py-2 text-[0.68rem] font-black uppercase tracking-[0.2em] text-white/75">
                  MP4, MOV, WebM, AVI, MKV
                </span>
              </div>
            </button>

            <div className="space-y-5 xl:border-l xl:border-white/10 xl:pl-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-[0.68rem] font-black uppercase tracking-[0.3em] text-white/60">Resumo</span>
                  <h2 className="mt-2 text-2xl font-black uppercase tracking-[0.12em] text-white">{totalFiles} arquivos</h2>
                </div>
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/10 text-tactical-pitch">
                  <Icon name="film" className="h-7 w-7" />
                </div>
              </div>

              {selectedFiles.length ? (
                <label className="block">
                  <span className="mb-2 block text-[0.68rem] font-black uppercase tracking-[0.28em] text-white/60">
                    Adicionar na playlist
                  </span>
                  <select
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/10 px-4 text-sm font-semibold text-white outline-none transition focus:border-tactical-pitch focus:ring-2 focus:ring-tactical-pitch/20"
                    value={form.playlistId}
                    onChange={(event) => setForm((current) => ({ ...current, playlistId: event.target.value }))}
                  >
                    {playlists.map((playlist) => (
                      <option key={playlist.id} value={playlist.id} className="bg-tactical-ink text-white">
                        {playlist.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <div className="space-y-4 border-y border-white/10 py-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-white/55">Playlist</span>
                  <strong className="text-sm font-black uppercase tracking-[0.14em] text-white">{selectedPlaylistName}</strong>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-white/55">Tipo</span>
                  <strong className="text-sm font-black uppercase tracking-[0.14em] text-white">{kindLabel(form.kind)}</strong>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-white/55">Tamanho total</span>
                  <strong className="text-sm font-black uppercase tracking-[0.14em] text-white">{formatBytes(totalBytes)}</strong>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3 text-[0.68rem] font-black uppercase tracking-[0.24em] text-white/60">
                  <span>Progresso geral</span>
                  <span>{overallProgress}%</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-tactical-pitch transition-all" style={{ width: `${overallProgress}%` }} />
                </div>
              </div>

              <button
                type="submit"
                form="upload-form"
                className="tactical-button w-full"
                disabled={isUploading || !selectedFiles.length}
              >
                <Icon name="upload" className="h-4 w-4" />
                {isUploading ? 'Enviando...' : totalFiles > 1 ? 'Publicar videos' : 'Publicar video'}
              </button>
            </div>
          </div>

          <div className="mt-6 border-t border-white/10 pt-5">
            <div className={cn('grid gap-4', selectedFiles.length === 1 ? 'xl:grid-cols-[minmax(0,1.1fr)_repeat(3,minmax(0,1fr))]' : 'xl:grid-cols-3')}>
              {selectedFiles.length === 1 ? (
                <label className="block">
                  <span className="mb-2 block text-[0.68rem] font-black uppercase tracking-[0.28em] text-white/60">Titulo</span>
                  <input
                    className="h-11 w-full rounded-xl border border-white/10 bg-white px-4 text-sm text-tactical-ink outline-none transition placeholder:text-tactical-ash/70 focus:border-tactical-pitch focus:ring-2 focus:ring-tactical-pitch/20"
                    maxLength={160}
                    value={form.title}
                    onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder={selectedFiles[0]?.title || 'Nome do video'}
                  />
                </label>
              ) : null}

              <label className="block">
                <span className="mb-2 block text-[0.68rem] font-black uppercase tracking-[0.28em] text-white/60">Tipo</span>
                <select
                  className="h-11 w-full rounded-xl border border-white/10 bg-white px-4 text-sm text-tactical-ink outline-none transition focus:border-tactical-pitch focus:ring-2 focus:ring-tactical-pitch/20"
                  value={form.kind}
                  onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))}
                >
                  <option value="jogo">Jogo</option>
                  <option value="treino">Treino</option>
                  <option value="highlight">Highlight</option>
                  <option value="analise">Analise</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-[0.68rem] font-black uppercase tracking-[0.28em] text-white/60">Visibilidade</span>
                <select
                  className="h-11 w-full rounded-xl border border-white/10 bg-white px-4 text-sm text-tactical-ink outline-none transition focus:border-tactical-pitch focus:ring-2 focus:ring-tactical-pitch/20"
                  value={form.visibility}
                  onChange={(event) => setForm((current) => ({ ...current, visibility: event.target.value }))}
                >
                  <option value="equipe">Equipe</option>
                  <option value="privado">Privado</option>
                  <option value="staff">Staff</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-[0.68rem] font-black uppercase tracking-[0.28em] text-white/60">Conta atual</span>
                <input
                  className="h-11 w-full rounded-xl border border-white/10 bg-white px-4 text-sm text-tactical-ink outline-none transition placeholder:text-tactical-ash/70 focus:border-tactical-pitch focus:ring-2 focus:ring-tactical-pitch/20"
                  value={form.uploader}
                  onChange={(event) => setForm((current) => ({ ...current, uploader: event.target.value }))}
                  placeholder="Nome exibido no feed"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="tactical-panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-tactical-ink/10 px-5 py-4">
            <h2 className="text-lg font-black uppercase tracking-[0.14em] text-tactical-ink">Fila de upload</h2>
            <span className="rounded-full border border-tactical-ink/10 bg-tactical-bone px-3 py-1 text-[0.68rem] font-black uppercase tracking-[0.18em] text-tactical-ash">
              {totalFiles}
            </span>
          </div>

          <div className="px-5 py-5">
            {!selectedFiles.length ? (
              <div className="rounded-2xl border border-dashed border-tactical-ink/12 px-4 py-10 text-center">
                <strong className="block text-sm font-black uppercase tracking-[0.18em] text-tactical-ink">
                  Nenhum video selecionado
                </strong>
                <span className="mt-2 block text-sm leading-6 text-tactical-ash">
                  Os arquivos escolhidos aparecem aqui em lista logo depois da selecao.
                </span>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-tactical-ink/10 bg-white">
                <div className="divide-y divide-tactical-ink/10">
                  {selectedFiles.map((item, index) => (
                    <article
                      key={item.key}
                      className="grid gap-4 px-4 py-4 md:grid-cols-[32px_minmax(0,1fr)_130px_110px_44px] md:items-center"
                    >
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-tactical-bone text-[0.72rem] font-black uppercase tracking-[0.08em] text-tactical-ash">
                        {index + 1}
                      </span>

                      <div className="min-w-0">
                        <strong className="block truncate text-sm font-black uppercase tracking-[0.14em] text-tactical-ink">
                          {item.title}
                        </strong>
                        <div className="mt-2 flex flex-wrap gap-3 text-[0.68rem] font-black uppercase tracking-[0.18em] text-tactical-ash">
                          <span>{formatBytes(item.file.size)}</span>
                          <span>{formatDuration(item.duration)}</span>
                          <span>{selectedPlaylistName}</span>
                        </div>
                      </div>

                      <div className="text-[0.68rem] font-black uppercase tracking-[0.18em]">
                        <span
                          className={cn(
                            item.status === 'done'
                              ? 'text-tactical-pitch'
                              : item.status === 'error'
                                ? 'text-tactical-ember'
                                : 'text-tactical-ash'
                          )}
                        >
                          {item.status === 'uploading'
                            ? 'Enviando'
                            : item.status === 'done'
                              ? 'Concluido'
                              : item.status === 'error'
                                ? 'Falhou'
                                : 'Pronto'}
                        </span>
                      </div>

                      <div>
                        <div className="mb-2 flex items-center justify-between gap-3 text-[0.68rem] font-black uppercase tracking-[0.18em] text-tactical-ash">
                          <span>{item.progress}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-tactical-ink/8">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all',
                              item.status === 'error' ? 'bg-tactical-ember' : 'bg-tactical-pitch'
                            )}
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                        {item.error ? <p className="mt-2 text-xs leading-5 text-tactical-ember">{item.error}</p> : null}
                      </div>

                      <button
                        type="button"
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-tactical-ink/10 text-tactical-ash transition hover:border-tactical-ember hover:text-tactical-ember disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => removeSelectedFile(item.key)}
                        disabled={isUploading}
                      >
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="tactical-panel overflow-hidden">
          <div className="px-5 py-5">
            <div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="text-[0.68rem] font-black uppercase tracking-[0.3em] text-tactical-ash">Playlists</span>
                  <h2 className="mt-2 text-2xl font-black uppercase tracking-[0.12em] text-tactical-ink">Criar nova playlist</h2>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-tactical-ash">
                    Organize os uploads antes de publicar. A playlist criada aqui ja pode ser escolhida no bloco de upload.
                  </p>
                </div>
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-tactical-pitch/10 text-tactical-pitch">
                  <Icon name="library" className="h-7 w-7" />
                </div>
              </div>

              <div className="mt-6 rounded-[1.75rem] border border-tactical-pitch/15 bg-tactical-bone/55 p-4">
                <label className="block">
                  <span className="tactical-label">Nome da playlist</span>
                  <input
                    className="tactical-input"
                    maxLength={120}
                    value={newPlaylistName}
                    onChange={(event) => setNewPlaylistName(event.target.value)}
                    placeholder="Ex: Finalizacao defensiva"
                  />
                </label>

                <div className="mt-4 flex flex-wrap gap-2">
                  {playlists.map((playlist) => (
                    <button
                      key={playlist.id}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, playlistId: playlist.id }))}
                      className={cn(
                        'inline-flex min-h-10 items-center rounded-full border px-4 text-[0.7rem] font-black uppercase tracking-[0.18em] transition',
                        playlist.id === form.playlistId
                          ? 'border-tactical-pitch bg-tactical-pitch text-white shadow-glow'
                          : 'border-tactical-ink/10 bg-white text-tactical-ash hover:border-tactical-pitch/35 hover:text-tactical-pitch'
                      )}
                    >
                      {playlist.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  className="tactical-button sm:w-auto"
                  onClick={handleCreatePlaylist}
                  disabled={isCreatingPlaylist}
                >
                  <Icon name="spark" className="h-4 w-4" />
                  {isCreatingPlaylist ? 'Criando...' : 'Criar playlist'}
                </button>

                <span className="inline-flex min-h-11 items-center rounded-xl border border-tactical-ink/10 bg-tactical-bone px-4 text-sm font-black uppercase tracking-[0.16em] text-tactical-ash">
                  Selecionada: {selectedPlaylistName}
                </span>
              </div>
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}
