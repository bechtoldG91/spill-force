import { Icon } from '../Icons';
import { cn } from '../../lib/utils';

export function AnnotationPanel({
  annotations,
  activeAnnotationId,
  noteTextareaRef,
  noteText,
  onNoteChange,
  onNoteKeyDown,
  onSaveAnnotation,
  onOpenAnnotation,
  onDeleteAnnotation,
  onDeleteAllAnnotations,
  annotationDisplayText
}) {
  return (
    <aside className="space-y-6">
      <div className="tactical-panel px-5 py-4">
        <div className="space-y-3">
          <label className="block">
            <span className="tactical-label">Nota</span>
            <textarea
              ref={noteTextareaRef}
              className="tactical-textarea min-h-20"
              rows="3"
              maxLength={900}
              placeholder="Shift + Q para digitar"
              value={noteText}
              onChange={(event) => onNoteChange(event.target.value)}
              onKeyDown={onNoteKeyDown}
            />
          </label>

          <button type="button" className="tactical-button w-full" onClick={onSaveAnnotation}>
            <Icon name="add-note" className="h-5 w-5" />
            Adicionar nota
          </button>
        </div>
      </div>

      <div className="tactical-panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-tactical-ink/10 px-5 py-2.5">
          <h2 className="text-sm font-black uppercase tracking-[0.12em] text-tactical-ink">Marcacoes</h2>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-tactical-pitch/10 text-xs font-black text-tactical-pitch">
              {annotations.length}
            </span>
            {annotations.length ? (
              <button
                type="button"
                aria-label="Deletar todas as marcacoes"
                title="Deletar todas as marcacoes"
                className="inline-flex h-8 items-center justify-center rounded-xl border border-red-600/25 bg-red-50 px-3 text-[0.58rem] font-black uppercase tracking-[0.14em] text-red-700 transition hover:border-red-600 hover:bg-red-100 hover:text-red-800"
                onClick={onDeleteAllAnnotations}
              >
                Limpar
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid max-h-[calc(100vh-18rem)] gap-3 overflow-y-auto px-5 py-5">
          {!annotations.length ? (
            <div className="rounded-2xl border border-dashed border-tactical-ink/12 px-4 py-10 text-center">
              <strong className="block text-sm font-black uppercase tracking-[0.18em] text-tactical-ink">Sem marcacoes</strong>
              <span className="mt-2 block text-sm leading-6 text-tactical-ash">As notas salvas aparecem aqui.</span>
            </div>
          ) : null}

          {annotations.map((annotation) => (
            <article
              key={annotation.id}
              className={cn(
                'rounded-xl border border-tactical-ink/10 bg-white p-3 shadow-sm transition',
                annotation.id === activeAnnotationId ? 'border-tactical-pitch shadow-glow' : ''
              )}
              style={{ borderLeftColor: annotation.color || '#3f8f29', borderLeftWidth: '5px' }}
            >
              <p className="text-sm leading-5 text-tactical-ash">{annotationDisplayText(annotation)}</p>

              <div className="mt-3 grid grid-cols-[minmax(0,1fr)_42px] gap-2">
                <button type="button" className="tactical-button-secondary min-h-10" onClick={() => onOpenAnnotation(annotation.id)}>
                  Abrir
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-red-600/25 bg-red-50 text-red-700 transition hover:border-red-600 hover:bg-red-100 hover:text-red-800"
                  onClick={() => onDeleteAnnotation(annotation.id)}
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </aside>
  );
}
