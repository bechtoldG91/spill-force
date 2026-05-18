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
import { LongCutPage } from './pages/LongCutPage';
import { authFetch, clearAuthSession, readAuthSession, setAuthSession } from './lib/auth';
import { canManageTeamSettings, isTeamManagerRole } from './lib/utils';

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
  const [clubNotificationsCount, setClubNotificationsCount] = useState(0);

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

  const refreshClubNotifications = useCallback(async (user = authUser) => {
    if (!user) {
      setClubNotificationsCount(0);
      return 0;
    }

    try {
      let teamsToCheck = [];

      if (user.globalAdmin) {
        const response = await authFetch('/api/teams');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Nao foi possivel carregar notificacoes.');
        }
        teamsToCheck = (payload.teams || []).map((team) => ({ teamId: team.id, role: 'admin' }));
      } else {
        teamsToCheck = (user.teamMemberships || []).filter((membership) => isTeamManagerRole(membership.role));
      }

      const counts = await Promise.all(
        teamsToCheck.map(async (membership) => {
          let total = 0;

          const roleResponse = await authFetch(`/api/teams/${encodeURIComponent(membership.teamId)}/role-change-requests`);
          const rolePayload = await roleResponse.json().catch(() => ({}));
          if (roleResponse.ok) {
            total += (rolePayload.requests || []).length;
          }

          const joinResponse = await authFetch(`/api/teams/${encodeURIComponent(membership.teamId)}/join-requests`);
          const joinPayload = await joinResponse.json().catch(() => ({}));
          if (joinResponse.ok) {
            total += (joinPayload.requests || []).length;
          }

          return total;
        })
      );

      const nextCount = counts.reduce((sum, count) => sum + count, 0);
      setClubNotificationsCount(nextCount);
      return nextCount;
    } catch {
      setClubNotificationsCount(0);
      return 0;
    }
  }, [authUser]);

  useEffect(() => {
    refreshClubNotifications();
  }, [refreshClubNotifications]);

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

  const handleRegister = useCallback(async ({ name, email, password, inviteCode }) => {
    const response = await authFetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, email, password, inviteCode })
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

  const handleForgotPassword = useCallback(async ({ email }) => {
    const response = await authFetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || 'Nao foi possivel gerar o codigo.');
    }

    showToast('Codigo de recuperacao gerado.');
    return payload;
  }, [showToast]);

  const handleResetPassword = useCallback(async ({ email, code, password }) => {
    const response = await authFetch('/api/auth/reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, code, password })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || 'Nao foi possivel redefinir a senha.');
    }

    setAuthSession(payload);
    setAuthUser(payload.user);
    setAuthReady(true);
    showToast('Senha redefinida.');
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

  const handleAccountDeleted = useCallback(() => {
    clearAuthSession();
    setAuthUser(null);
    setAuthReady(true);
    setClubNotificationsCount(0);
    showToast('Conta excluida.');
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
          <Route
            path="/novousuario"
            element={
              <AuthPage
                mode="login"
                onLogin={handleLogin}
                onRegister={handleRegister}
                onForgotPassword={handleForgotPassword}
                onResetPassword={handleResetPassword}
                showToast={showToast}
              />
            }
          />
          <Route path="/novousuario.html" element={<Navigate to="/novousuario" replace />} />
          <Route
            path="/cadastro"
            element={
              <AuthPage
                mode="register"
                onLogin={handleLogin}
                onRegister={handleRegister}
                onForgotPassword={handleForgotPassword}
                onResetPassword={handleResetPassword}
                showToast={showToast}
              />
            }
          />
          <Route path="/cadastro.html" element={<Navigate to="/cadastro" replace />} />
          <Route
            path="/recuperar-senha"
            element={
              <AuthPage
                mode="forgot"
                onLogin={handleLogin}
                onRegister={handleRegister}
                onForgotPassword={handleForgotPassword}
                onResetPassword={handleResetPassword}
                showToast={showToast}
              />
            }
          />
          <Route path="/recuperar-senha.html" element={<Navigate to="/recuperar-senha" replace />} />
          <Route path="/conta" element={<Navigate to="/novousuario" replace />} />
          <Route path="/conta.html" element={<Navigate to="/novousuario" replace />} />
          <Route path="*" element={<Navigate to="/novousuario" replace />} />
        </Routes>

        <Toast message={toast} />
      </>
    );
  }

  const hasTeamMemberships = Boolean((authUser.teamMemberships || []).length);
  const canCreateContent = canManageTeamSettings(authUser);
  const canAccessTeamContent = Boolean(authUser.globalAdmin || hasTeamMemberships);
  const canManageClub = canManageTeamSettings(authUser);

  return (
    <>
      <Routes>
        <Route
          path="*"
          element={
            <AppShell
              authUser={authUser}
              onLogout={handleLogout}
              clubNotificationsCount={clubNotificationsCount}
            >
              <Routes key={authUser?.id || 'legacy'}>
                <Route
                  path="/"
                  element={
                    <HomePage
                      showToast={showToast}
                      authUser={authUser}
                      clubNotificationsCount={clubNotificationsCount}
                      onAuthRefresh={refreshAuthUser}
                    />
                  }
                />
                <Route path="/index.html" element={<Navigate to="/" replace />} />
                <Route path="/novousuario" element={<Navigate to="/" replace />} />
                <Route path="/novousuario.html" element={<Navigate to="/" replace />} />
                <Route path="/cadastro" element={<Navigate to="/" replace />} />
                <Route path="/cadastro.html" element={<Navigate to="/" replace />} />
                <Route path="/recuperar-senha" element={<Navigate to="/" replace />} />
                <Route path="/recuperar-senha.html" element={<Navigate to="/" replace />} />
                <Route path="/conta" element={<Navigate to="/configuracoes-da-conta" replace />} />
                <Route path="/conta.html" element={<Navigate to="/configuracoes-da-conta" replace />} />
                <Route path="/perfil" element={<Navigate to="/configuracoes-da-conta" replace />} />
                <Route path="/perfil.html" element={<Navigate to="/configuracoes-da-conta" replace />} />
                <Route
                  path="/configuracoes-da-conta"
                  element={
                    <AccountPage
                      authUser={authUser}
                      mode="settings"
                      showToast={showToast}
                      onAuthRefresh={refreshAuthUser}
                      onAccountDeleted={handleAccountDeleted}
                    />
                  }
                />
                <Route path="/configuracoes-da-conta.html" element={<Navigate to="/configuracoes-da-conta" replace />} />
                <Route
                  path="/time"
                  element={
                    <TeamPage
                      showToast={showToast}
                      authUser={authUser}
                      onAuthRefresh={refreshAuthUser}
                      clubNotificationsCount={clubNotificationsCount}
                    />
                  }
                />
                <Route path="/time.html" element={<Navigate to="/time" replace />} />
                <Route
                  path="/club-manage"
                  element={
                    canManageClub ? (
                      <ClubManagePage
                        showToast={showToast}
                        authUser={authUser}
                        onAuthRefresh={refreshAuthUser}
                        onNotificationsRefresh={refreshClubNotifications}
                      />
                    ) : (
                      <Navigate to="/time" replace />
                    )
                  }
                />
                <Route path="/club-manage.html" element={<Navigate to="/club-manage" replace />} />
                <Route path="/times" element={<Navigate to="/time" replace />} />
                <Route path="/times.html" element={<Navigate to="/time" replace />} />
                <Route path="/times/:teamId" element={<Navigate to="/time" replace />} />
                <Route path="/upload" element={canCreateContent ? <UploadPage showToast={showToast} /> : <Navigate to="/biblioteca" replace />} />
                <Route path="/upload.html" element={<Navigate to="/upload" replace />} />
                <Route path="/biblioteca" element={canAccessTeamContent ? <LibraryPage showToast={showToast} /> : <Navigate to="/time" replace />} />
                <Route path="/biblioteca.html" element={<Navigate to="/biblioteca" replace />} />
                <Route path="/corte-longo" element={canAccessTeamContent ? <LongCutPage showToast={showToast} /> : <Navigate to="/time" replace />} />
                <Route path="/corte-longo.html" element={<Navigate to="/corte-longo" replace />} />
                <Route path="/analise" element={canAccessTeamContent ? <AnalysisPage showToast={showToast} /> : <Navigate to="/time" replace />} />
                <Route path="/analise.html" element={<Navigate to="/analise" replace />} />
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
