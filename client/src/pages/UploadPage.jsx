import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icons';
import { cn, formatBytes, formatDuration, kindLabel } from '../lib/utils';

const VIDEO_EXTENSIONS = ['.avi', '.mov', '.mp4', '.mpeg', '.mpg', '.wmv'];
const VIDEO_MIME_TYPES = ['video/x-msvideo', 'video/quicktime', 'video/mp4', 'video/mpeg', 'video/x-ms-wmv'];
const PLAYLIST_DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
});

function formatUploadPlaylistName(date = new Date()) {
  return PLAYLIST_DATE_FORMATTER.format(date);
}

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
  const fileName = String(file?.name || '').toLowerCase();
  if (VIDEO_EXTENSIONS.some((extension) => fileName.endsWith(extension))) {
    return true;
  }

  const mimeType = String(file?.type || '').toLowerCase();
  return VIDEO_MIME_TYPES.includes(mimeType);
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
    visibility: 'equipe'
  });

  const totalFiles = selectedFiles.length;
  const totalBytes = useMemo(
    () => selectedFiles.reduce((sum, item) => sum + (item.file.size || 0), 0),
    [selectedFiles]
  );
  const selectedPlaylistName = useMemo(
    () => playlists.find((playlist) => playlist.id === form.playlistId)?.name || formatUploadPlaylistName(),
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
          playlistId: current.playlistId || ''
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
        kind: form.kind,
        visibility: form.visibility,
        uploader: 'Coach Gui'
      });

      if (form.playlistId) {
        params.set('playlistId', form.playlistId);
      }

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
    <section className="space-y-5">
      <form id="upload-form" className="space-y-5" onSubmit={handleSubmit}>
        <div className={cn('grid gap-4', selectedFiles.length ? 'grid-cols-1' : 'md:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]')}>
          <input
            ref={inputRef}
            type="file"
            accept=".avi,.mov,.mp4,.mpeg,.mpg,.wmv"
            multiple
            className="hidden"
            onChange={async (event) => {
              await appendFiles(event.target.files);
              event.target.value = '';
            }}
          />

          <div className="overflow-hidden rounded-[1.9rem] p-4 sm:p-5" style={{ backgroundColor: '#002244' }}>
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
                'grid min-h-[220px] w-full place-items-center rounded-[1.65rem] border-2 border-dashed px-6 py-8 text-center transition md:min-h-[260px]',
                isDragging
                  ? 'border-white/70 bg-white/10'
                  : 'border-white/20 bg-white/5 hover:border-white/50 hover:bg-white/10'
              )}
            >
              <div>
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-tactical-pitch text-white shadow-glow">
                  <Icon name="upload" className="h-7 w-7" />
                </div>
                <strong className="mt-4 block text-lg font-black uppercase tracking-[0.14em] text-white">
                  Soltar videos aqui
                </strong>
                <span className="mt-4 inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-[0.68rem] font-black uppercase tracking-[0.2em] text-white/80">
                  AVI, MOV, MP4, MPEG, MPG, WMV
                </span>
              </div>
            </button>
          </div>

          {!selectedFiles.length ? (
            <div className="overflow-hidden rounded-[1.9rem] p-4 sm:p-5" style={{ backgroundColor: '#A5acaf' }}>
              <div className="flex min-h-[220px] flex-col justify-between rounded-[1.65rem] border border-white/30 bg-white/18 p-5 sm:p-6 md:min-h-[260px]">
                <div className="text-center">
                  <h2 className="text-[1.9rem] font-black uppercase leading-[0.95] tracking-[0.12em] text-tactical-ink">
                    Criar nova
                    <br />
                    playlist
                  </h2>
                </div>

                <div className="mt-5 space-y-4">
                  <label className="block">
                    <input
                      className="h-12 w-full rounded-2xl border border-tactical-ink/15 bg-white px-4 text-sm text-tactical-ink outline-none transition placeholder:text-tactical-ash/70 focus:border-tactical-pitch/50"
                      maxLength={120}
                      value={newPlaylistName}
                      onChange={(event) => setNewPlaylistName(event.target.value)}
                      placeholder="Ex: treino de quarta-feira ou periodo de skelly"
                    />
                  </label>

                  <button
                    type="button"
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-tactical-ink px-5 text-sm font-black uppercase tracking-[0.18em] text-white transition hover:bg-tactical-pitch disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={handleCreatePlaylist}
                    disabled={isCreatingPlaylist}
                  >
                    {isCreatingPlaylist ? 'Criando...' : 'Criar'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {selectedFiles.length ? (
          <div className="overflow-hidden rounded-2xl border border-[#c7d7ea] bg-[#dce8f5] shadow-panel">
            <div className="space-y-4 px-4 py-4 sm:px-5 sm:py-5">
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <h2 className="text-xl font-black uppercase tracking-[0.12em] text-tactical-ink sm:text-2xl">Configurar upload</h2>
                </div>

                <div className="rounded-[1.9rem] border border-tactical-line/45 bg-gradient-to-br from-tactical-bone via-white to-tactical-bone/70 px-4 py-4 shadow-[0_18px_38px_rgba(0,34,68,0.08)] sm:px-5 sm:py-5">
                  <div className={cn('grid gap-4', selectedFiles.length === 1 ? 'lg:grid-cols-[minmax(0,1.05fr)_repeat(3,minmax(0,1fr))]' : 'lg:grid-cols-3')}>
                    {selectedFiles.length === 1 ? (
                      <label className="block rounded-[1.4rem] border border-tactical-line/35 bg-white/85 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                        <span className="mb-3 block text-[0.76rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Titulo</span>
                        <input
                          className="h-12 w-full rounded-xl border border-tactical-line/45 bg-white px-4 text-base font-semibold text-tactical-ink outline-none transition placeholder:text-tactical-ash/75 focus:border-tactical-pitch focus:ring-2 focus:ring-tactical-pitch/20"
                          maxLength={160}
                          value={form.title}
                          onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                          placeholder={selectedFiles[0]?.title || 'Nome do video'}
                        />
                      </label>
                    ) : null}

                    <label className="block rounded-[1.4rem] border border-tactical-line/35 bg-white/85 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                      <span className="mb-3 block text-[0.76rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Adicionar na playlist</span>
                      <select
                        className="h-12 w-full rounded-xl border border-tactical-line/45 bg-white px-4 text-base font-semibold text-tactical-ink outline-none transition focus:border-tactical-pitch focus:ring-2 focus:ring-tactical-pitch/20"
                        value={form.playlistId}
                        onChange={(event) => setForm((current) => ({ ...current, playlistId: event.target.value }))}
                      >
                        <option value="">Usar Data</option>
                        {playlists.map((playlist) => (
                          <option key={playlist.id} value={playlist.id}>
                            {playlist.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block rounded-[1.4rem] border border-tactical-line/35 bg-white/85 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                      <span className="mb-3 block text-[0.76rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Tipo</span>
                      <select
                        className="h-12 w-full rounded-xl border border-tactical-line/45 bg-white px-4 text-base font-semibold text-tactical-ink outline-none transition focus:border-tactical-pitch focus:ring-2 focus:ring-tactical-pitch/20"
                        value={form.kind}
                        onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))}
                      >
                        <option value="jogo">Jogo</option>
                        <option value="treino">Treino</option>
                        <option value="highlight">Highlight</option>
                        <option value="analise">Analise</option>
                      </select>
                    </label>

                    <label className="block rounded-[1.4rem] border border-tactical-line/35 bg-white/85 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                      <span className="mb-3 block text-[0.76rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Visibilidade</span>
                      <select
                        className="h-12 w-full rounded-xl border border-tactical-line/45 bg-white px-4 text-base font-semibold text-tactical-ink outline-none transition focus:border-tactical-pitch focus:ring-2 focus:ring-tactical-pitch/20"
                        value={form.visibility}
                        onChange={(event) => setForm((current) => ({ ...current, visibility: event.target.value }))}
                      >
                        <option value="equipe">Equipe</option>
                        <option value="privado">Privado</option>
                        <option value="staff">Staff</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)] xl:items-stretch">
                <div className="w-full overflow-hidden rounded-[1.9rem] p-3.5 sm:p-4" style={{ backgroundColor: '#A5acaf' }}>
                  <div className="flex h-full min-h-[228px] flex-col rounded-[1.65rem] border border-white/30 bg-white/18 p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-[0.68rem] font-black uppercase tracking-[0.28em] text-tactical-ash">Playlist rapida</span>
                        <h3 className="mt-2 text-[1.35rem] font-black uppercase leading-[0.95] tracking-[0.12em] text-tactical-ink sm:text-[1.55rem]">
                          Criar nova playlist
                        </h3>
                      </div>
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-tactical-ink/8 text-tactical-ink">
                        <Icon name="folder-plus" className="h-5 w-5" />
                      </div>
                    </div>

                    <div className="mt-4 flex flex-1 flex-col justify-end space-y-3">
                      <label className="block">
                        <input
                          className="h-11 w-full rounded-2xl border border-tactical-ink/15 bg-white px-4 text-sm text-tactical-ink outline-none transition placeholder:text-tactical-ash/70 focus:border-tactical-pitch/50"
                          maxLength={120}
                          value={newPlaylistName}
                          onChange={(event) => setNewPlaylistName(event.target.value)}
                          placeholder="Ex: treino de quarta-feira ou periodo de skelly"
                        />
                      </label>

                      <button
                        type="button"
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-tactical-ink px-5 text-sm font-black uppercase tracking-[0.18em] text-white transition hover:bg-tactical-pitch disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={handleCreatePlaylist}
                        disabled={isCreatingPlaylist}
                      >
                        {isCreatingPlaylist ? 'Criando...' : 'Criar'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="w-full overflow-hidden rounded-[1.9rem] p-3.5 sm:p-4" style={{ backgroundColor: '#A5acaf' }}>
                  <div className="flex h-full min-h-[228px] flex-col rounded-[1.65rem] border border-white/30 bg-white/18 p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="text-[0.68rem] font-black uppercase tracking-[0.28em] text-tactical-ash">Resumo</span>
                        <h3 className="mt-2 text-xl font-black uppercase tracking-[0.12em] text-tactical-ink sm:text-2xl">{totalFiles} arquivos</h3>
                      </div>
                      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-tactical-pitch/10 text-tactical-pitch">
                        <Icon name="film" className="h-6 w-6" />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 border-y border-tactical-ink/10 py-3 text-sm sm:grid-cols-3">
                      <div className="space-y-1">
                        <span className="block text-[0.68rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Playlist</span>
                        <strong className="block text-sm font-black uppercase tracking-[0.14em] text-tactical-ink sm:leading-5">{selectedPlaylistName}</strong>
                      </div>
                      <div className="space-y-1">
                        <span className="block text-[0.68rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Tipo</span>
                        <strong className="block text-sm font-black uppercase tracking-[0.14em] text-tactical-ink">{kindLabel(form.kind)}</strong>
                      </div>
                      <div className="space-y-1">
                        <span className="block text-[0.68rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Tamanho total</span>
                        <strong className="block text-sm font-black uppercase tracking-[0.14em] text-tactical-ink">{formatBytes(totalBytes)}</strong>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between gap-3 text-[0.68rem] font-black uppercase tracking-[0.24em] text-tactical-ash">
                        <span>Progresso geral</span>
                        <span>{overallProgress}%</span>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-tactical-ink/8">
                        <div className="h-full rounded-full bg-tactical-pitch transition-all" style={{ width: `${overallProgress}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center pt-0.5">
                <button
                  type="submit"
                  form="upload-form"
                  className="tactical-button min-h-[52px] min-w-[336px] text-base"
                  disabled={isUploading || !selectedFiles.length}
                >
                  <Icon name="upload" className="h-5 w-5" />
                  {isUploading ? 'Enviando...' : 'Upload'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="tactical-panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-tactical-ink/10 px-5 py-3.5">
            <h2 className="text-base font-black uppercase tracking-[0.14em] text-tactical-ink">Fila de upload</h2>
            <span className="rounded-full border border-tactical-ink/10 bg-tactical-bone px-2.5 py-1 text-[0.62rem] font-black uppercase tracking-[0.16em] text-tactical-ash">
              {totalFiles}
            </span>
          </div>

          <div className="px-5 py-4">
            {!selectedFiles.length ? (
              <div className="rounded-2xl border border-dashed border-tactical-ink/12 px-4 py-6 text-center">
                <strong className="block text-xs font-black uppercase tracking-[0.18em] text-tactical-ink">
                  Nenhum video selecionado
                </strong>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-tactical-ink/10 bg-white">
                <div className="max-h-[320px] divide-y divide-tactical-ink/10 overflow-y-auto">
                  {selectedFiles.map((item, index) => (
                    <article
                      key={item.key}
                      className="grid gap-3 px-4 py-3 md:grid-cols-[26px_minmax(0,1fr)_92px_92px_40px] md:items-center"
                    >
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-tactical-bone text-[0.62rem] font-black uppercase tracking-[0.08em] text-tactical-ash">
                        {index + 1}
                      </span>

                      <div className="min-w-0">
                        <strong className="block truncate text-[0.82rem] font-black uppercase tracking-[0.12em] text-tactical-ink">
                          {item.title}
                        </strong>
                        <div className="mt-1.5 flex flex-wrap gap-2 text-[0.62rem] font-black uppercase tracking-[0.16em] text-tactical-ash">
                          <span>{formatBytes(item.file.size)}</span>
                          <span>{formatDuration(item.duration)}</span>
                          <span>{selectedPlaylistName}</span>
                        </div>
                        {item.error ? <p className="mt-1.5 text-xs leading-5 text-tactical-ember">{item.error}</p> : null}
                      </div>

                      <div className="text-[0.62rem] font-black uppercase tracking-[0.16em]">
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
                        <div className="mb-1.5 flex items-center justify-between gap-2 text-[0.62rem] font-black uppercase tracking-[0.16em] text-tactical-ash">
                          <span>{item.progress}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-tactical-ink/8">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all',
                              item.status === 'error' ? 'bg-tactical-ember' : 'bg-tactical-pitch'
                            )}
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-tactical-ink/10 text-tactical-ash transition hover:border-tactical-ember hover:bg-tactical-ember/10 hover:text-tactical-ember disabled:cursor-not-allowed disabled:opacity-40"
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

      </form>
    </section>
  );
}
