import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import authHeroImage from '../assets/spill-force-auth.png';

const EMPTY_FORM = {
  name: '',
  email: '',
  password: ''
};

export function AuthPage({ mode = 'login', onLogin, onRegister, showToast }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);

  const isRegister = mode === 'register';

  useEffect(() => {
    setForm(EMPTY_FORM);
  }, [mode]);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);

    try {
      if (isRegister) {
        await onRegister(form);
      } else {
        await onLogin(form);
      }
      setForm(EMPTY_FORM);
    } catch (error) {
      showToast(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="field-grid min-h-screen bg-tactical-bone text-tactical-ink">
      <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-5 py-3">
        <div className="text-2xl font-black uppercase italic leading-none tracking-tight">
          <span className="text-tactical-ink">Spill</span>
          <span className="text-tactical-pitch">&amp;Force</span>
        </div>
      </header>

      <main className="mx-auto grid min-h-[calc(100vh-68px)] w-full max-w-[1120px] items-center gap-5 px-5 pb-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(340px,400px)]">
        <section className="tactical-dark-panel overflow-hidden px-5 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto max-w-[360px] overflow-hidden rounded-xl bg-white p-2 shadow-xl xl:max-w-[400px]">
            <img
              src={authHeroImage}
              alt="Diagrama tatico Spill and Force"
              className="aspect-[1/1] w-full rounded-lg bg-white object-contain"
            />
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {[
              ['Upload', 'Videos com audio removido no processamento.'],
              ['Analise', 'Marcacoes e notas vinculadas ao usuario.'],
              ['Times', 'Permissoes por papel dentro de cada equipe.']
            ].map(([title, text]) => (
              <div key={title} className="rounded-xl border border-white/10 bg-white/10 px-3 py-3">
                <strong className="block text-xs font-black uppercase tracking-[0.16em] text-white">{title}</strong>
                <span className="mt-1.5 block text-[0.7rem] font-semibold leading-4 text-white/60">{text}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="tactical-panel px-4 py-4 sm:px-5 sm:py-5">
          <div>
            <span className="tactical-label">{isRegister ? 'Novo usuario' : 'Acesso'}</span>
            <h1 className="text-2xl font-black tracking-tight text-tactical-ink">
              {isRegister ? 'Criar conta' : 'Entrar'}
            </h1>
          </div>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            {isRegister ? (
              <label className="block">
                <span className="tactical-label">Nome</span>
                <input
                  className="tactical-input"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Nome completo"
                  autoComplete="name"
                  maxLength={120}
                />
              </label>
            ) : null}

            <label className="block">
              <span className="tactical-label">Email</span>
              <input
                className="tactical-input"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="email@exemplo.com"
                type="email"
                autoComplete="email"
                maxLength={160}
                required
              />
            </label>

            <label className="block">
              <span className="tactical-label">Senha</span>
              <input
                className="tactical-input"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                placeholder={isRegister ? 'Minimo de 8 caracteres' : 'Sua senha'}
                type="password"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                minLength={isRegister ? 8 : undefined}
                required
              />
            </label>

            <button type="submit" className="tactical-button min-h-[52px] w-full" disabled={loading}>
              {loading ? 'Aguarde...' : isRegister ? 'Criar conta' : 'Entrar'}
            </button>
          </form>

          <Link
            to={isRegister ? '/novousuario' : '/cadastro'}
            className="mt-4 block rounded-xl border border-tactical-ink/10 bg-tactical-bone px-3 py-3 text-center text-sm font-semibold text-tactical-ash transition hover:border-tactical-pitch/35 hover:bg-tactical-pitch/10 hover:text-tactical-ink"
          >
            {isRegister ? (
              <>
                Ja tem conta? <strong className="font-black text-tactical-pitch">Entrar</strong>
              </>
            ) : (
              <>
                Usuario novo? <strong className="font-black text-tactical-pitch">Criar conta</strong>
              </>
            )}
          </Link>
        </section>
      </main>
    </div>
  );
}
