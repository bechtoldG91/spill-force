import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import authHeroImage from '../assets/spill-force-auth.png';

const EMPTY_FORM = {
  name: '',
  email: '',
  password: '',
  code: '',
  inviteCode: '',
  confirmPassword: ''
};

export function AuthPage({ mode = 'login', onLogin, onRegister, onForgotPassword, onResetPassword, showToast }) {
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);

  const isRegister = mode === 'register';
  const isForgot = mode === 'forgot';
  const inviteCodeFromUrl = isRegister ? searchParams.get('convite') || searchParams.get('invite') || '' : '';

  useEffect(() => {
    setForm({
      ...EMPTY_FORM,
      inviteCode: inviteCodeFromUrl
    });
    setShowPassword(false);
    setResetRequested(false);
  }, [inviteCodeFromUrl, mode]);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);

    try {
      if (isForgot && !resetRequested) {
        await onForgotPassword({ email: form.email });
        setResetRequested(true);
        return;
      }

      if (isForgot) {
        if (form.password !== form.confirmPassword) {
          throw new Error('A confirmacao da senha nao confere.');
        }
        await onResetPassword({
          email: form.email,
          code: form.code,
          password: form.password
        });
      } else if (isRegister) {
        await onRegister(form);
      } else {
        await onLogin(form);
      }
      setForm(EMPTY_FORM);
      setResetRequested(false);
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
            <span className="tactical-label">{isRegister ? 'Novo usuario' : isForgot ? 'Recuperacao' : 'Acesso'}</span>
            <h1 className="text-2xl font-black tracking-tight text-tactical-ink">
              {isRegister ? 'Criar conta' : isForgot ? 'Redefinir senha' : 'Entrar'}
            </h1>
          </div>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            {isRegister ? (
              <>
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

                <label className="block">
                  <span className="tactical-label">Codigo do convite</span>
                  <input
                    className="tactical-input"
                    value={form.inviteCode}
                    onChange={(event) => setForm((current) => ({ ...current, inviteCode: event.target.value.trim() }))}
                    placeholder="Opcional"
                    autoComplete="one-time-code"
                    maxLength={120}
                  />
                  <span className="mt-1 block text-xs font-semibold text-tactical-ash">
                    Use um codigo para entrar direto no clube ou deixe em branco para solicitar entrada depois.
                  </span>
                </label>

              </>
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
                disabled={isForgot && resetRequested}
                required
              />
            </label>

            {isForgot && resetRequested ? (
              <div className="rounded-xl border border-tactical-pitch/25 bg-tactical-pitch/10 px-3 py-3 text-sm font-semibold text-tactical-ink">
                <span>Se este email existir, use o codigo recebido para criar uma nova senha.</span>
                <span className="mt-2 block text-xs font-semibold text-tactical-ash">O codigo expira em 15 minutos.</span>
                <button
                  type="button"
                  className="mt-3 text-xs font-black uppercase tracking-[0.14em] text-tactical-pitch hover:text-tactical-ink"
                  onClick={() => {
                    setResetRequested(false);
                    setForm((current) => ({ ...current, code: '', password: '', confirmPassword: '' }));
                  }}
                >
                  Trocar email
                </button>
              </div>
            ) : null}

            {!isForgot || resetRequested ? (
              <>
                {isForgot ? (
                  <label className="block">
                    <span className="tactical-label">Codigo</span>
                    <input
                      className="tactical-input"
                      value={form.code}
                      onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.replace(/\D/g, '').slice(0, 6) }))}
                      inputMode="numeric"
                      maxLength={6}
                      required
                    />
                  </label>
                ) : null}

                <label className="block">
                  <span className="tactical-label">{isForgot ? 'Nova senha' : 'Senha'}</span>
                  <div className="relative">
                    <input
                      className="tactical-input pr-14"
                      value={form.password}
                      onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                      placeholder={isRegister || isForgot ? 'Minimo de 8 caracteres' : 'Sua senha'}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={isRegister || isForgot ? 'new-password' : 'current-password'}
                      minLength={isRegister || isForgot ? 8 : undefined}
                      required
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-xl text-tactical-ash transition hover:bg-tactical-pitch/10 hover:text-tactical-pitch focus:outline-none focus:ring-2 focus:ring-tactical-pitch/35"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      <Icon name={showPassword ? 'eye-off' : 'eye'} className="h-5 w-5" />
                    </button>
                  </div>
                </label>

                {isForgot ? (
                  <label className="block">
                    <span className="tactical-label">Confirmar senha</span>
                    <input
                      className="tactical-input"
                      value={form.confirmPassword}
                      onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  </label>
                ) : null}
              </>
            ) : null}

            <button type="submit" className="tactical-button min-h-[52px] w-full" disabled={loading}>
              {loading ? 'Aguarde...' : isRegister ? 'Criar conta' : isForgot && !resetRequested ? 'Gerar codigo' : isForgot ? 'Redefinir senha' : 'Entrar'}
            </button>
          </form>

          {isForgot ? (
            <Link
              to="/novousuario"
              className="mt-4 block rounded-xl border border-tactical-ink/10 bg-tactical-bone px-3 py-3 text-center text-sm font-semibold text-tactical-ash transition hover:border-tactical-pitch/35 hover:bg-tactical-pitch/10 hover:text-tactical-ink"
            >
              Voltar para <strong className="font-black text-tactical-pitch">login</strong>
            </Link>
          ) : (
            <>
              {!isRegister ? (
                <Link
                  to="/recuperar-senha"
                  className="mt-3 block text-center text-xs font-black uppercase tracking-[0.14em] text-tactical-pitch transition hover:text-tactical-ink"
                >
                  Esqueci minha senha
                </Link>
              ) : null}

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
                    <strong className="font-black text-tactical-pitch">Criar conta</strong>
                  </>
                )}
              </Link>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
