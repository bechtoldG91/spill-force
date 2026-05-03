import { Navigate, Route, Routes } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from './components/AppShell';
import { AccountPage } from './pages/AccountPage';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/HomePage';
import { TeamPage } from './pages/TeamPage';
import { ClubManagePage } from './pages/ClubManagePage';
import { UploadPage } from './pages/UploadPage';
import { LibraryPage } from './pages/LibraryPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { NewsPage } from './pages/NewsPage';
import { LongCutPage } from './pages/LongCutPage';
import { authFetch, clearAuthSession, readAuthSession, setAuthSession } from './lib/auth';

function Toast({ message }) {
  return (
    <div
      className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border border-tactical-pitch/30 bg-tactical-ink px-4 py-3 text-sm font-semibold text-white shadow-glow transition ${
        message ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
      }`}
    >
      {message}
    </div>
  );
}

function AuthLoading() {
  return (
    <div className="field-grid grid min-h-screen place-items-center bg-tactical-bone px-5 text-tactical-ink">
      <div className="tactical-panel w-full max-w-sm px-5 py-6 text-center">
        <div className="text-2xl font-black uppercase italic leading-none tracking-tight">
          <span className="text-tactical-ink">Spill</span>
          <span className="text-tactical-pitch">&amp;Force</span>
        </div>
        <p className="mt-4 text-sm font-semibold text-tactical-ash">Validando sessao...</p>
      </div>
    </div>
  );
}

export default function App() {
  const [toast, setToast] = useState('');
  const [initialSession] = useState(() => readAuthSession());
  const [authUser, setAuthUser] = useState(() => initialSession?.user || null);
  const [authReady, setAuthReady] = useState(() => !initialSession?.token);

  const showToast = useCallback((message) => {
    setToast(String(message || ''));
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    let ignore = false;

    async function loadSession() {
      const session = readAuthSession();
      if (!session?.token) {
        setAuthReady(true);
        return;
      }

      try {
        const response = await authFetch('/api/auth/me');
        const payload = await response.json().catch(() => ({}));
        if (!ignore && response.ok) {
          const nextUser = payload.user || null;
          setAuthUser(nextUser);
          if (nextUser) {
            setAuthSession({ token: session.token, user: nextUser });
          } else {
            clearAuthSession();
          }
        } else if (!ignore) {
          clearAuthSession();
          setAuthUser(null);
        }
      } catch {
        if (!ignore) {
          clearAuthSession();
          setAuthUser(null);
        }
      } finally {
        if (!ignore) {
          setAuthReady(true);
        }
      }
    }

    loadSession();
    return () => {
      ignore = true;
    };
  }, []);

  const refreshAuthUser = useCallback(async () => {
    const session = readAuthSession();
    if (!session?.token) {
      clearAuthSession();
      setAuthUser(null);
      return null;
    }

    const response = await authFetch('/api/auth/me');
    const payload = await response.json().catch(() => ({}));
    const nextUser = response.ok ? payload.user || null : null;

    if (nextUser) {
      setAuthSession({ token: session.token, user: nextUser });
      setAuthUser(nextUser);
    } else {
      clearAuthSession();
      setAuthUser(null);
    }

    return nextUser;
  }, []);

  const handleLogin = useCallback(async ({ email, password }) => {
    const response = await authFetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || 'Nao foi possivel entrar.');
    }

    setAuthSession(payload);
    setAuthUser(payload.user);
    setAuthReady(true);
    showToast('Login realizado.');
  }, [showToast]);

  const handleRegister = useCallback(async ({ name, email, password }) => {
    const response = await authFetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, email, password })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || 'Nao foi possivel criar a conta.');
    }

    setAuthSession(payload);
    setAuthUser(payload.user);
    setAuthReady(true);
    showToast('Conta criada.');
  }, [showToast]);

  const handleLogout = useCallback(async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      clearAuthSession();
      setAuthUser(null);
      setAuthReady(true);
      showToast('Logout realizado.');
    }
  }, [showToast]);

  if (!authReady) {
    return (
      <>
        <AuthLoading />
        <Toast message={toast} />
      </>
    );
  }

  if (!authUser) {
    return (
      <>
        <Routes>
          <Route path="/novousuario" element={<AuthPage mode="login" onLogin={handleLogin} onRegister={handleRegister} showToast={showToast} />} />
          <Route path="/novousuario.html" element={<Navigate to="/novousuario" replace />} />
          <Route path="/cadastro" element={<AuthPage mode="register" onLogin={handleLogin} onRegister={handleRegister} showToast={showToast} />} />
          <Route path="/cadastro.html" element={<Navigate to="/cadastro" replace />} />
          <Route path="/conta" element={<Navigate to="/novousuario" replace />} />
          <Route path="/conta.html" element={<Navigate to="/novousuario" replace />} />
          <Route path="*" element={<Navigate to="/novousuario" replace />} />
        </Routes>

        <Toast message={toast} />
      </>
    );
  }

  return (
    <>
      <Routes>
        <Route
          path="*"
          element={
            <AppShell
              authUser={authUser}
              onLogout={handleLogout}
            >
              <Routes key={authUser?.id || 'legacy'}>
                <Route path="/" element={<HomePage showToast={showToast} authUser={authUser} />} />
                <Route path="/index.html" element={<Navigate to="/" replace />} />
                <Route path="/novousuario" element={<Navigate to="/" replace />} />
                <Route path="/novousuario.html" element={<Navigate to="/" replace />} />
                <Route path="/cadastro" element={<Navigate to="/" replace />} />
                <Route path="/cadastro.html" element={<Navigate to="/" replace />} />
                <Route path="/conta" element={<Navigate to="/" replace />} />
                <Route path="/conta.html" element={<Navigate to="/" replace />} />
                <Route path="/perfil" element={<AccountPage authUser={authUser} mode="profile" showToast={showToast} onAuthRefresh={refreshAuthUser} />} />
                <Route path="/perfil.html" element={<Navigate to="/perfil" replace />} />
                <Route
                  path="/configuracoes-da-conta"
                  element={<AccountPage authUser={authUser} mode="settings" showToast={showToast} onAuthRefresh={refreshAuthUser} />}
                />
                <Route path="/configuracoes-da-conta.html" element={<Navigate to="/configuracoes-da-conta" replace />} />
                <Route path="/time" element={<TeamPage showToast={showToast} authUser={authUser} onAuthRefresh={refreshAuthUser} />} />
                <Route path="/time.html" element={<Navigate to="/time" replace />} />
                <Route path="/club-manage" element={<ClubManagePage showToast={showToast} authUser={authUser} />} />
                <Route path="/club-manage.html" element={<Navigate to="/club-manage" replace />} />
                <Route path="/times" element={<Navigate to="/time" replace />} />
                <Route path="/times.html" element={<Navigate to="/time" replace />} />
                <Route path="/times/:teamId" element={<Navigate to="/time" replace />} />
                <Route path="/upload" element={<UploadPage showToast={showToast} />} />
                <Route path="/upload.html" element={<Navigate to="/upload" replace />} />
                <Route path="/biblioteca" element={<LibraryPage showToast={showToast} />} />
                <Route path="/biblioteca.html" element={<Navigate to="/biblioteca" replace />} />
                <Route path="/corte-longo" element={<LongCutPage showToast={showToast} />} />
                <Route path="/corte-longo.html" element={<Navigate to="/corte-longo" replace />} />
                <Route path="/analise" element={<AnalysisPage showToast={showToast} />} />
                <Route path="/analise.html" element={<Navigate to="/analise" replace />} />
                <Route path="/noticias" element={<NewsPage showToast={showToast} authUser={authUser} />} />
                <Route path="/noticias.html" element={<Navigate to="/noticias" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShell>
          }
        />
      </Routes>

      <Toast message={toast} />
    </>
  );
}
