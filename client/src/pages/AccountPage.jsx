import { useEffect, useMemo, useState } from 'react';
import { UserAvatar } from '../components/UserAvatar';
import { APP_USER } from '../lib/constants';
import { authFetch } from '../lib/auth';

const MAX_PROFILE_PHOTO_BYTES = 900 * 1024;
const ACCEPTED_PROFILE_PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const EMPTY_PASSWORD_FORM = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
};

function splitDisplayName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ')
  };
}

function profileFormFromUser(user) {
  const nameParts = splitDisplayName(user?.name);
  return {
    firstName: user?.firstName || nameParts.firstName || '',
    lastName: user?.lastName || nameParts.lastName || '',
    phone: user?.phone || ''
  };
}

function DetailRow({ label, value }) {
  return (
    <div className="border-b border-tactical-ink/10 py-3 last:border-b-0">
      <span className="block text-[0.68rem] font-black uppercase tracking-[0.2em] text-tactical-ash">{label}</span>
      <strong className="mt-1 block truncate text-sm font-black text-tactical-ink">{value || '-'}</strong>
    </div>
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Nao foi possivel carregar a imagem.'));
    reader.readAsDataURL(file);
  });
}

export function AccountPage({ authUser, mode = 'settings', showToast = () => {}, onAuthRefresh, onAccountDeleted }) {
  const currentUser = authUser || APP_USER;
  const memberships = authUser?.teamMemberships || APP_USER.teams || [];
  const isSettings = mode === 'settings';
  const [avatarPreview, setAvatarPreview] = useState(currentUser.avatarDataUrl || '');
  const [profileForm, setProfileForm] = useState(() => profileFormFromUser(currentUser));
  const [passwordForm, setPasswordForm] = useState(EMPTY_PASSWORD_FORM);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminUserSearch, setAdminUserSearch] = useState('');
  const [loadingAdminUsers, setLoadingAdminUsers] = useState(false);
  const [deletingAdminUserId, setDeletingAdminUserId] = useState('');

  useEffect(() => {
    setAvatarPreview(currentUser.avatarDataUrl || '');
    setProfileForm(profileFormFromUser(currentUser));
  }, [
    currentUser.avatarDataUrl,
    currentUser.firstName,
    currentUser.id,
    currentUser.lastName,
    currentUser.name,
    currentUser.phone
  ]);

  useEffect(() => {
    if (!isSettings || !authUser?.globalAdmin) {
      return undefined;
    }

    let ignore = false;
    async function loadAdminUsers() {
      setLoadingAdminUsers(true);
      try {
        const response = await authFetch('/api/admin/users');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Nao foi possivel carregar usuarios.');
        }
        if (!ignore) {
          setAdminUsers(payload.users || []);
        }
      } catch (error) {
        if (!ignore) {
          showToast(error.message);
        }
      } finally {
        if (!ignore) {
          setLoadingAdminUsers(false);
        }
      }
    }

    loadAdminUsers();
    return () => {
      ignore = true;
    };
  }, [authUser?.globalAdmin, isSettings, showToast]);

  const filteredAdminUsers = useMemo(() => {
    const query = adminUserSearch.trim().toLowerCase();
    if (!query) {
      return adminUsers;
    }

    return adminUsers.filter((user) =>
      [user.name, user.email, ...(user.teamMemberships || []).map((membership) => membership.name || membership.teamId)]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [adminUserSearch, adminUsers]);

  function updateProfileField(field, value) {
    setProfileForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updatePasswordField(field, value) {
    setPasswordForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function saveProfilePhoto(avatarDataUrl, successMessage) {
    setSavingAvatar(true);
    try {
      const response = await authFetch('/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ avatarDataUrl })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel salvar a foto do perfil.');
      }

      setAvatarPreview(payload.user?.avatarDataUrl || '');
      await onAuthRefresh?.();
      showToast(successMessage);
    } catch (error) {
      showToast(error.message);
    } finally {
      setSavingAvatar(false);
    }
  }

  async function handleProfilePhotoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!ACCEPTED_PROFILE_PHOTO_TYPES.has(file.type)) {
      showToast('Use uma imagem PNG, JPG ou WebP.');
      event.target.value = '';
      return;
    }

    if (file.size > MAX_PROFILE_PHOTO_BYTES) {
      showToast('Use uma imagem com ate 900 KB.');
      event.target.value = '';
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      await saveProfilePhoto(dataUrl, 'Foto de perfil atualizada.');
    } catch (error) {
      showToast(error.message);
    } finally {
      event.target.value = '';
    }
  }

  async function saveAccountSettings() {
    const firstName = profileForm.firstName.trim();
    if (!firstName) {
      showToast('Informe o nome.');
      return;
    }

    const requestPayload = {
      firstName,
      lastName: profileForm.lastName.trim(),
      phone: profileForm.phone.trim()
    };

    setSavingSettings(true);
    try {
      const response = await authFetch('/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload)
      });
      const responsePayload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(responsePayload.error || 'Nao foi possivel salvar as configuracoes da conta.');
      }

      await onAuthRefresh?.();
      showToast('Configuracoes salvas.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();

    if (passwordForm.newPassword.length < 8) {
      showToast('A nova senha deve ter pelo menos 8 caracteres.');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showToast('A confirmacao da senha nao confere.');
      return;
    }

    setSavingPassword(true);
    try {
      const response = await authFetch('/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword
        })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel alterar a senha.');
      }

      setPasswordForm(EMPTY_PASSWORD_FORM);
      await onAuthRefresh?.();
      showToast('Senha alterada.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setSavingPassword(false);
    }
  }

  async function deleteOwnAccount() {
    if (deleteConfirmation.trim().toUpperCase() !== 'EXCLUIR') {
      showToast('Digite EXCLUIR para confirmar.');
      return;
    }

    if (!window.confirm('Excluir sua conta permanentemente?')) {
      return;
    }

    setDeletingAccount(true);
    try {
      const response = await authFetch('/api/auth/me', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ confirmation: deleteConfirmation.trim() })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel excluir a conta.');
      }

      setDeleteConfirmation('');
      if (onAccountDeleted) {
        await onAccountDeleted();
      } else {
        showToast('Conta excluida.');
      }
    } catch (error) {
      showToast(error.message);
    } finally {
      setDeletingAccount(false);
    }
  }

  async function deleteAdminUser(user) {
    if (!user?.id || user.id === currentUser.id) {
      showToast('Use Excluir minha conta para remover sua propria conta.');
      return;
    }

    if (!window.confirm(`Excluir a conta de ${user.name || user.email}?`)) {
      return;
    }

    setDeletingAdminUserId(user.id);
    try {
      const response = await authFetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'DELETE'
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel excluir o usuario.');
      }

      setAdminUsers((current) => current.filter((item) => item.id !== user.id));
      showToast('Conta excluida.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setDeletingAdminUserId('');
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-[1080px] flex-col gap-5">
      <div className="tactical-dark-panel flex flex-col gap-5 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <UserAvatar user={{ ...currentUser, avatarDataUrl: avatarPreview }} className="h-16 w-16 text-xl" />
          <div className="min-w-0">
            <span className="block text-[0.68rem] font-black uppercase tracking-[0.24em] text-white/55">
              {isSettings ? 'Configuracoes da conta' : 'Perfil'}
            </span>
            <h1 className="mt-1 truncate text-3xl font-black tracking-tight text-white">{currentUser.name}</h1>
            <span className="mt-1 block truncate text-sm font-semibold text-white/60">{currentUser.email}</span>
          </div>
        </div>

        {authUser?.globalAdmin ? (
          <span className="inline-flex self-start rounded-full bg-white/10 px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.18em] text-white sm:self-center">
            Admin global
          </span>
        ) : null}
      </div>

      {isSettings ? (
        <div className="grid gap-5 lg:grid-cols-3">
          <article className="tactical-panel px-5 py-5 lg:col-span-2">
            <h2 className="text-lg font-black tracking-tight text-tactical-ink">Dados da conta</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="tactical-label">Nome</span>
                <input
                  className="tactical-input"
                  value={profileForm.firstName}
                  onChange={(event) => updateProfileField('firstName', event.target.value)}
                  autoComplete="given-name"
                  maxLength={80}
                  required
                />
              </label>

              <label className="block">
                <span className="tactical-label">Sobrenome</span>
                <input
                  className="tactical-input"
                  value={profileForm.lastName}
                  onChange={(event) => updateProfileField('lastName', event.target.value)}
                  autoComplete="family-name"
                  maxLength={120}
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="tactical-label">Numero de celular</span>
                <input
                  className="tactical-input"
                  value={profileForm.phone}
                  onChange={(event) => updateProfileField('phone', event.target.value)}
                  type="tel"
                  autoComplete="tel"
                  maxLength={40}
                />
              </label>

              <div className="sm:col-span-2">
                <DetailRow label="Email" value={currentUser.email} />
              </div>
            </div>

            <div className="mt-6 border-t border-tactical-ink/10 pt-5">
              <h2 className="text-lg font-black tracking-tight text-tactical-ink">Mudar senha</h2>
              <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={savePassword}>
                <label className="block sm:col-span-2">
                  <span className="tactical-label">Senha atual</span>
                  <input
                    className="tactical-input"
                    value={passwordForm.currentPassword}
                    onChange={(event) => updatePasswordField('currentPassword', event.target.value)}
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>

                <label className="block">
                  <span className="tactical-label">Nova senha</span>
                  <input
                    className="tactical-input"
                    value={passwordForm.newPassword}
                    onChange={(event) => updatePasswordField('newPassword', event.target.value)}
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>

                <label className="block">
                  <span className="tactical-label">Confirmar senha</span>
                  <input
                    className="tactical-input"
                    value={passwordForm.confirmPassword}
                    onChange={(event) => updatePasswordField('confirmPassword', event.target.value)}
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>

                <button type="submit" className="tactical-button sm:col-span-2" disabled={savingPassword}>
                  {savingPassword ? 'Salvando...' : 'Alterar senha'}
                </button>
              </form>
            </div>
          </article>

          <article className="tactical-panel px-5 py-5">
            <h2 className="text-lg font-black tracking-tight text-tactical-ink">Alterar foto</h2>
            <div className="mt-4 flex items-center gap-4">
              <UserAvatar user={{ ...currentUser, avatarDataUrl: avatarPreview }} className="h-20 w-20 text-2xl" />
              <div className="min-w-0 flex-1">
                <label className="tactical-button-secondary w-full cursor-pointer">
                  {savingAvatar ? 'Salvando...' : 'Escolher foto'}
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={savingAvatar}
                    onChange={handleProfilePhotoUpload}
                  />
                </label>
                {avatarPreview ? (
                  <button
                    type="button"
                    className="mt-2 w-full rounded-xl border border-tactical-ink/10 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-tactical-ash transition hover:border-tactical-pitch/35 hover:text-tactical-pitch"
                    disabled={savingAvatar}
                    onClick={() => saveProfilePhoto('', 'Foto de perfil removida.')}
                  >
                    Remover foto
                  </button>
                ) : null}
              </div>
            </div>
            <p className="mt-3 text-xs font-semibold leading-5 text-tactical-ash">PNG, JPG ou WebP ate 900 KB.</p>

            <div className="mt-6 border-t border-red-200 pt-5">
              <h2 className="text-lg font-black tracking-tight text-red-800">Excluir conta</h2>
              <div className="mt-4 grid gap-3">
                <label className="block">
                  <span className="tactical-label">Confirmacao</span>
                  <input
                    className="tactical-input border-red-200 focus:border-red-500"
                    value={deleteConfirmation}
                    onChange={(event) => setDeleteConfirmation(event.target.value)}
                    placeholder="Digite EXCLUIR"
                  />
                </label>
                <button
                  type="button"
                  className="h-11 rounded-xl bg-red-700 px-4 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={deletingAccount || deleteConfirmation.trim().toUpperCase() !== 'EXCLUIR'}
                  onClick={deleteOwnAccount}
                >
                  {deletingAccount ? 'Excluindo...' : 'Excluir minha conta'}
                </button>
              </div>
            </div>
          </article>

          {authUser?.globalAdmin ? (
            <article className="tactical-panel px-5 py-5 lg:col-span-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-black tracking-tight text-tactical-ink">Administracao de contas</h2>
                <span className="rounded-full bg-tactical-pitch/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-tactical-pitch">
                  {adminUsers.length} usuarios
                </span>
              </div>

              <label className="mt-4 block">
                <span className="tactical-label">Buscar usuario</span>
                <input
                  className="tactical-input"
                  value={adminUserSearch}
                  onChange={(event) => setAdminUserSearch(event.target.value)}
                  placeholder="Nome, email ou clube"
                />
              </label>

              <div className="mt-4 grid gap-3">
                {loadingAdminUsers ? (
                  <div className="rounded-xl border border-dashed border-tactical-ink/15 px-4 py-6 text-center text-sm font-black uppercase tracking-[0.14em] text-tactical-ash">
                    Carregando usuarios...
                  </div>
                ) : null}

                {!loadingAdminUsers && !filteredAdminUsers.length ? (
                  <div className="rounded-xl border border-dashed border-tactical-ink/15 px-4 py-6 text-center text-sm font-black uppercase tracking-[0.14em] text-tactical-ash">
                    Nenhum usuario encontrado
                  </div>
                ) : null}

                {filteredAdminUsers.map((user) => {
                  const isCurrentUser = user.id === currentUser.id;
                  return (
                    <div
                      key={user.id}
                      className="grid gap-3 rounded-xl border border-tactical-ink/10 bg-white px-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(160px,0.45fr)_auto] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="truncate text-sm font-black text-tactical-ink">{user.name || user.email}</strong>
                          {user.globalAdmin ? (
                            <span className="rounded-full bg-tactical-ink px-2 py-1 text-[0.62rem] font-black uppercase tracking-[0.12em] text-white">
                              Admin global
                            </span>
                          ) : null}
                          {isCurrentUser ? (
                            <span className="rounded-full bg-tactical-pitch/10 px-2 py-1 text-[0.62rem] font-black uppercase tracking-[0.12em] text-tactical-pitch">
                              Sua conta
                            </span>
                          ) : null}
                        </div>
                        <span className="mt-1 block truncate text-xs font-semibold text-tactical-ash">{user.email}</span>
                      </div>

                      <span className="text-xs font-black uppercase tracking-[0.12em] text-tactical-ash">
                        {user.teamMemberships?.length
                          ? `${user.teamMemberships.length} clube${user.teamMemberships.length > 1 ? 's' : ''}`
                          : 'Sem clube'}
                      </span>

                      <button
                        type="button"
                        className="h-10 rounded-xl border border-red-200 px-3 text-xs font-black uppercase tracking-[0.14em] text-red-700 transition hover:border-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-45"
                        disabled={isCurrentUser || deletingAdminUserId === user.id}
                        onClick={() => deleteAdminUser(user)}
                      >
                        {deletingAdminUserId === user.id ? 'Excluindo...' : 'Excluir'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </article>
          ) : null}

          <div className="flex justify-end lg:col-span-3">
            <button type="button" className="tactical-button min-h-12 w-full sm:w-auto sm:min-w-[220px]" disabled={savingSettings} onClick={saveAccountSettings}>
              {savingSettings ? 'Salvando...' : 'Salvar configuracoes'}
            </button>
          </div>

        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(300px,0.55fr)]">
          <article className="tactical-panel px-5 py-5">
            <h2 className="text-lg font-black tracking-tight text-tactical-ink">Dados do perfil</h2>
            <div className="mt-3">
              <DetailRow label="Nome" value={currentUser.firstName || currentUser.name} />
              <DetailRow label="Sobrenome" value={currentUser.lastName} />
              <DetailRow label="Email" value={currentUser.email} />
              <DetailRow label="Numero de celular" value={currentUser.phone} />
            </div>
          </article>

          <article className="tactical-panel px-5 py-5">
            <h2 className="text-lg font-black tracking-tight text-tactical-ink">Times</h2>
            <div className="mt-4 space-y-3">
              {memberships.length ? (
                memberships.map((membership) => {
                  const teamName = membership.name || membership.teamId || 'Time';
                  return (
                    <div key={membership.teamId || membership.id || teamName} className="rounded-xl border border-tactical-ink/10 px-3 py-3">
                      <strong className="block truncate text-sm font-black text-tactical-ink">{teamName}</strong>
                      <span className="mt-1 block truncate text-xs font-semibold uppercase tracking-[0.16em] text-tactical-ash">
                        {membership.role || membership.note || 'Membro'}
                      </span>
                    </div>
                  );
                })
              ) : (
                <span className="block rounded-xl border border-tactical-ink/10 px-3 py-3 text-sm font-semibold text-tactical-ash">
                  Nenhum time vinculado.
                </span>
              )}
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
