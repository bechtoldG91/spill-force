import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { APP_USER } from '../lib/constants';
import { authFetch } from '../lib/auth';
import { cn, isTeamManagerRole, normalizeRole } from '../lib/utils';

const ROLE_LABELS = {
  admin: 'Admin',
  treinador: 'Treinador',
  atleta: 'Atleta'
};

const ROLE_OPTIONS = [
  { value: 'atleta', label: 'Atleta' },
  { value: 'treinador', label: 'Treinador' },
  { value: 'admin', label: 'Admin' }
];

const MEMBER_ROLE_ORDER = {
  admin: 0,
  treinador: 1,
  atleta: 2
};

const SECTOR_OPTIONS = [
  { value: 'ataque', label: 'Ataque', positions: ['QB', 'RB', 'WR', 'TE', 'OL'] },
  { value: 'defesa', label: 'Defesa', positions: ['DL', 'LB', 'DB'] },
  { value: 'special-teams', label: 'Special Teams', positions: ['K/P'] }
];

const EMPTY_TEAM_FORM = {
  name: '',
  city: '',
  logoDataUrl: '',
  socialLinks: {
    instagram: '',
    website: '',
    facebook: '',
    x: ''
  }
};

const EMPTY_EVENT_FORM = {
  title: '',
  startsAt: '',
  location: ''
};

const EMPTY_ATHLETE_PROFILE_FORM = {
  nickname: '',
  jerseyNumber: '',
  sector: 'ataque',
  position: ''
};

const ROSTER_TABLE_LABEL_CLASS = 'px-3 py-2 text-[0.62rem] font-black uppercase tracking-[0.16em] text-tactical-ash';
const ROSTER_TABLE_CELL_CLASS = 'border-b border-tactical-line/35 px-3 py-3 align-middle text-sm font-semibold text-tactical-ink';

function roleLabel(role) {
  return ROLE_LABELS[role] || role || 'Membro';
}

function sectorForPosition(position) {
  const normalizedPosition = String(position || '').toUpperCase();
  return SECTOR_OPTIONS.find((option) => option.positions.includes(normalizedPosition))?.value || '';
}

function positionsForSector(sector) {
  return SECTOR_OPTIONS.find((option) => option.value === sector)?.positions || [];
}

function sectorLabel(sector) {
  return SECTOR_OPTIONS.find((option) => option.value === sector)?.label || sector || '';
}

function athleteProfileFormFromMember(member) {
  const sector = member?.sector || sectorForPosition(member?.position) || 'ataque';
  const positions = positionsForSector(sector);
  const position = positions.includes(String(member?.position || '').toUpperCase()) ? String(member?.position || '').toUpperCase() : '';

  return {
    nickname: member?.nickname || '',
    jerseyNumber: member?.jerseyNumber || '',
    sector,
    position
  };
}

function athleteProfileSignature(form) {
  return JSON.stringify([
    String(form?.nickname || ''),
    String(form?.jerseyNumber || ''),
    String(form?.sector || ''),
    String(form?.position || '')
  ]);
}

function formatEventDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Data a definir';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function createClientId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `event-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

function TeamLogo({ team, className = 'h-16 w-16', roundedClassName = 'rounded-2xl' }) {
  return (
    <div className={cn('grid shrink-0 place-items-center overflow-hidden bg-tactical-pitch text-white shadow-glow', roundedClassName, className)}>
      {team?.logoDataUrl ? (
        <img src={team.logoDataUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <Icon name="team" className="h-8 w-8" />
      )}
    </div>
  );
}

function initialTeams(authUser) {
  if (authUser) {
    return (authUser.teamMemberships || []).map((membership) => ({
      id: membership.teamId,
      name: membership.teamId,
      city: '',
      logoDataUrl: '',
      coverDataUrl: '',
      upcomingEvents: [],
      socialLinks: {},
      role: normalizeRole(membership.role) || membership.role,
      members: [],
      loading: true
    }));
  }

  return APP_USER.teams.map((team) => ({
    id: team.id,
    name: team.name,
    city: '',
    logoDataUrl: '',
    coverDataUrl: '',
    upcomingEvents: [],
    socialLinks: {},
    role: normalizeRole(team.role) || team.role,
    note: team.note,
    members: [
      {
        id: APP_USER.email,
        name: APP_USER.name,
        email: APP_USER.email,
        initials: APP_USER.initials,
        role: APP_USER.role
      }
    ],
    loading: false
  }));
}

export function TeamPage({ authUser, showToast, onAuthRefresh, clubNotificationsCount = 0 }) {
  const [teams, setTeams] = useState(() => initialTeams(authUser));
  const [activeTeamId, setActiveTeamId] = useState('');
  const [teamForm, setTeamForm] = useState(EMPTY_TEAM_FORM);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [eventForm, setEventForm] = useState(EMPTY_EVENT_FORM);
  const [savingEvents, setSavingEvents] = useState(false);
  const [requestingRoleChange, setRequestingRoleChange] = useState(false);
  const [teamRoleDraft, setTeamRoleDraft] = useState('');
  const [leavingTeam, setLeavingTeam] = useState(false);
  const [athleteProfileForm, setAthleteProfileForm] = useState(EMPTY_ATHLETE_PROFILE_FORM);
  const [athleteProfileBaseline, setAthleteProfileBaseline] = useState(athleteProfileSignature(EMPTY_ATHLETE_PROFILE_FORM));
  const [savingAthleteProfile, setSavingAthleteProfile] = useState(false);
  const [availableTeams, setAvailableTeams] = useState([]);
  const [requestingJoinTeamId, setRequestingJoinTeamId] = useState('');
  const hasClubMembership = Boolean((authUser?.teamMemberships || []).length);

  useEffect(() => {
    let ignore = false;

    async function loadTeams() {
      if (!authUser?.teamMemberships?.length) {
        setTeams(initialTeams(authUser));
        setActiveTeamId('');
        try {
          const response = await authFetch('/api/teams');
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.error || 'Nao foi possivel carregar clubes.');
          }
          if (!ignore) {
            setAvailableTeams(payload.teams || []);
          }
        } catch (error) {
          if (!ignore) {
            setAvailableTeams([]);
            showToast(error.message);
          }
        }
        return;
      }

      setAvailableTeams([]);
      const loadingTeams = initialTeams(authUser);
      setTeams(loadingTeams);
      setActiveTeamId((current) => (loadingTeams.some((team) => team.id === current) ? current : loadingTeams[0]?.id || ''));

      try {
        const loadedTeams = await Promise.all(
          authUser.teamMemberships.map(async (membership) => {
            const [teamResponse, membersResponse] = await Promise.all([
              authFetch(`/api/teams/${encodeURIComponent(membership.teamId)}`),
              authFetch(`/api/teams/${encodeURIComponent(membership.teamId)}/members`)
            ]);

            const teamPayload = await teamResponse.json().catch(() => ({}));
            const membersPayload = await membersResponse.json().catch(() => ({}));

            if (!teamResponse.ok || !membersResponse.ok) {
              throw new Error(teamPayload.error || membersPayload.error || 'Nao foi possivel carregar o time.');
            }

            return {
              id: membership.teamId,
              name: teamPayload.team?.name || membership.teamId,
              city: teamPayload.team?.city || '',
              logoDataUrl: teamPayload.team?.logoDataUrl || '',
              coverDataUrl: teamPayload.team?.coverDataUrl || '',
              upcomingEvents: teamPayload.team?.upcomingEvents || [],
              socialLinks: teamPayload.team?.socialLinks || {},
              role: normalizeRole(membership.role) || membership.role,
              ownerIds: teamPayload.team?.ownerIds || [],
              members: membersPayload.members || [],
              loading: false
            };
          })
        );

        if (!ignore) {
          setTeams(loadedTeams);
          setActiveTeamId((current) => (loadedTeams.some((team) => team.id === current) ? current : loadedTeams[0]?.id || ''));
        }
      } catch (error) {
        if (!ignore) {
          showToast(error.message);
          setTeams((current) => current.map((team) => ({ ...team, loading: false })));
        }
      }
    }

    loadTeams();
    return () => {
      ignore = true;
    };
  }, [authUser, showToast]);

  const activeTeam = teams.find((team) => team.id === activeTeamId) || teams[0] || null;
  const upcomingEvents = activeTeam?.upcomingEvents || [];
  const canCreateTeam = Boolean(authUser?.globalAdmin) && !hasClubMembership && teams.length === 0;
  const canEditEvents = Boolean(activeTeam && (authUser?.globalAdmin || isTeamManagerRole(activeTeam.role)));
  const activeMembers = [...(activeTeam?.members || [])].sort((left, right) => {
    const roleResult = (MEMBER_ROLE_ORDER[left.role] ?? 99) - (MEMBER_ROLE_ORDER[right.role] ?? 99);
    if (roleResult !== 0) {
      return roleResult;
    }

    return String(left.name || left.email || '').localeCompare(String(right.name || right.email || ''), 'pt-BR', {
      sensitivity: 'base'
    });
  });
  const currentAthleteMember = activeMembers.find((member) => member.id === authUser?.id) || null;
  const canEditOwnAthleteProfile = Boolean(activeTeam?.role === 'atleta' && currentAthleteMember && !authUser?.globalAdmin);
  const athletePositionOptions = positionsForSector(athleteProfileForm.sector);
  const athleteProfileChanged = athleteProfileSignature(athleteProfileForm) !== athleteProfileBaseline;
  const hasRoleDraftChange = Boolean(activeTeam?.role && teamRoleDraft && teamRoleDraft !== activeTeam.role);

  useEffect(() => {
    setTeamRoleDraft(activeTeam?.role || '');
  }, [activeTeam?.id, activeTeam?.role]);

  useEffect(() => {
    if (!canEditOwnAthleteProfile) {
      setAthleteProfileForm(EMPTY_ATHLETE_PROFILE_FORM);
      setAthleteProfileBaseline(athleteProfileSignature(EMPTY_ATHLETE_PROFILE_FORM));
      return;
    }

    const nextForm = athleteProfileFormFromMember(currentAthleteMember);
    setAthleteProfileForm(nextForm);
    setAthleteProfileBaseline(athleteProfileSignature(nextForm));
  }, [
    activeTeam?.id,
    canEditOwnAthleteProfile,
    currentAthleteMember?.id,
    currentAthleteMember?.jerseyNumber,
    currentAthleteMember?.nickname,
    currentAthleteMember?.position,
    currentAthleteMember?.sector
  ]);

  function updateTeamField(field, value) {
    setTeamForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateSocialLink(field, value) {
    setTeamForm((current) => ({
      ...current,
      socialLinks: {
        ...current.socialLinks,
        [field]: value
      }
    }));
  }

  function updateEventField(field, value) {
    setEventForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateAthleteProfileField(field, value) {
    setAthleteProfileForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateAthleteProfileSector(sector) {
    setAthleteProfileForm((current) => ({
      ...current,
      sector,
      position: positionsForSector(sector).includes(current.position) ? current.position : ''
    }));
  }

  function mergeUpdatedTeam(updatedTeam) {
    setTeams((current) =>
      current.map((team) =>
        team.id === activeTeam.id
          ? {
              ...team,
              ...updatedTeam,
              role: team.role,
              members: team.members,
              loading: false
            }
          : team
      )
    );
  }

  function mergeUpdatedMember(updatedMember) {
    if (!activeTeam?.id || !updatedMember?.id) {
      return;
    }

    setTeams((current) =>
      current.map((team) => {
        if (team.id !== activeTeam.id) {
          return team;
        }

        const members = Array.isArray(team.members) ? team.members : [];
        const hasMember = members.some((member) => member.id === updatedMember.id);
        return {
          ...team,
          members: hasMember
            ? members.map((member) => (member.id === updatedMember.id ? { ...member, ...updatedMember } : member))
            : [...members, updatedMember]
        };
      })
    );
  }

  function handleLogoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) {
      updateTeamField('logoDataUrl', '');
      return;
    }

    if (!file.type.startsWith('image/')) {
      showToast('Selecione uma imagem valida para o logo.');
      event.target.value = '';
      return;
    }

    if (file.size > 700 * 1024) {
      showToast('Use um logo com ate 700 KB.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => updateTeamField('logoDataUrl', String(reader.result || ''));
    reader.onerror = () => showToast('Nao foi possivel carregar o logo.');
    reader.readAsDataURL(file);
  }

  async function saveTeamEvents(nextEvents, successMessage) {
    if (!activeTeam?.id) {
      return;
    }

    setSavingEvents(true);
    try {
      const response = await authFetch(`/api/teams/${encodeURIComponent(activeTeam.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ upcomingEvents: nextEvents })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel salvar os eventos.');
      }

      mergeUpdatedTeam(payload.team);
      showToast(successMessage);
      return true;
    } catch (error) {
      showToast(error.message);
      return false;
    } finally {
      setSavingEvents(false);
    }
  }

  async function saveAthleteProfile(event) {
    event.preventDefault();

    if (!activeTeam?.id || !canEditOwnAthleteProfile || !athleteProfileChanged) {
      return;
    }

    setSavingAthleteProfile(true);
    try {
      const response = await authFetch(`/api/teams/${encodeURIComponent(activeTeam.id)}/my-membership`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          nickname: athleteProfileForm.nickname,
          jerseyNumber: athleteProfileForm.jerseyNumber,
          sector: athleteProfileForm.sector,
          position: athleteProfileForm.position
        })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel salvar seus dados no clube.');
      }

      const nextForm = athleteProfileFormFromMember(payload.member);
      mergeUpdatedMember(payload.member);
      setAthleteProfileForm(nextForm);
      setAthleteProfileBaseline(athleteProfileSignature(nextForm));
      showToast('Dados de atleta atualizados.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setSavingAthleteProfile(false);
    }
  }

  async function addEvent(event) {
    event.preventDefault();

    const title = eventForm.title.trim();
    if (!title) {
      showToast('Informe o nome do evento.');
      return;
    }

    const nextEvents = [
      ...upcomingEvents,
      {
        id: createClientId(),
        title,
        startsAt: eventForm.startsAt,
        location: eventForm.location.trim()
      }
    ];

    const saved = await saveTeamEvents(nextEvents, 'Evento adicionado.');
    if (saved) {
      setEventForm(EMPTY_EVENT_FORM);
    }
  }

  async function removeEvent(eventId) {
    await saveTeamEvents(upcomingEvents.filter((event) => event.id !== eventId), 'Evento removido.');
  }

  async function createTeam(event) {
    event.preventDefault();

    const name = teamForm.name.trim();
    if (!name) {
      showToast('Informe o nome do time.');
      return;
    }

    setCreatingTeam(true);
    try {
      const response = await authFetch('/api/teams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          city: teamForm.city,
          logoDataUrl: teamForm.logoDataUrl,
          socialLinks: teamForm.socialLinks
        })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel criar o time.');
      }

      setTeamForm(EMPTY_TEAM_FORM);
      await onAuthRefresh?.();
      showToast('Time criado.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setCreatingTeam(false);
    }
  }

  async function requestTeamRoleChange(role) {
    if (!activeTeam?.id || requestingRoleChange) {
      return false;
    }

    setRequestingRoleChange(true);
    try {
      const response = await authFetch(`/api/teams/${encodeURIComponent(activeTeam.id)}/role-change-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ role })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel solicitar a troca de funcao.');
      }

      showToast(`Solicitacao para ${roleLabel(role)} enviada.`);
      return true;
    } catch (error) {
      showToast(error.message);
      return false;
    } finally {
      setRequestingRoleChange(false);
    }
  }

  async function requestJoinTeam(teamId) {
    if (!teamId || requestingJoinTeamId) {
      return;
    }

    setRequestingJoinTeamId(teamId);
    try {
      const response = await authFetch(`/api/teams/${encodeURIComponent(teamId)}/join-requests`, {
        method: 'POST'
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel solicitar entrada no clube.');
      }

      setAvailableTeams((current) => current.map((team) => (team.id === teamId ? { ...team, pendingJoinRequest: true } : team)));
      showToast('Solicitacao enviada ao clube.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setRequestingJoinTeamId('');
    }
  }

  async function saveTeamRoleDraft() {
    if (!hasRoleDraftChange) {
      return;
    }

    const sent = await requestTeamRoleChange(teamRoleDraft);
    if (sent) {
      setTeamRoleDraft(activeTeam.role);
    }
  }

  async function leaveActiveTeam() {
    if (!activeTeam?.id || leavingTeam) {
      return;
    }

    const confirmed = window.confirm(`Sair do time "${activeTeam.name}"?`);
    if (!confirmed) {
      return;
    }

    setLeavingTeam(true);
    try {
      const response = await authFetch(`/api/teams/${encodeURIComponent(activeTeam.id)}/leave`, {
        method: 'DELETE'
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel sair do time.');
      }

      const nextTeams = teams.filter((team) => team.id !== activeTeam.id);
      setTeams(nextTeams);
      setActiveTeamId(nextTeams[0]?.id || '');
      await onAuthRefresh?.();
      showToast('Voce saiu do time.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setLeavingTeam(false);
    }
  }

  if (!activeTeam && hasClubMembership) {
    return (
      <section className="tactical-panel px-6 py-10 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-tactical-pitch/10 text-tactical-pitch">
          <Icon name="team" className="h-7 w-7" />
        </div>
        <strong className="mt-4 block text-sm font-black uppercase tracking-[0.16em] text-tactical-ink">
          Carregando clube
        </strong>
      </section>
    );
  }

  if (!activeTeam) {
    return canCreateTeam ? (
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <article className="tactical-dark-panel self-start px-6 py-6">
          <span className="block text-[0.68rem] font-black uppercase tracking-[0.24em] text-white/55">Admin global</span>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-white">CRIAR CLUBE</h1>
          <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-white/65">
            O acesso de novos usuarios passa a acontecer por convites enviados nas configuracoes.
          </p>
        </article>

        <aside className="self-start">
          <form className="tactical-panel px-5 py-5" onSubmit={createTeam}>
            <span className="tactical-label">Novo clube</span>
            <h2 className="text-xl font-black tracking-tight text-tactical-ink">Criar clube</h2>

            <div className="mt-4 flex items-center gap-3 rounded-xl border border-tactical-line/35 bg-tactical-bone/55 px-3 py-3">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-tactical-ink/10 bg-white text-tactical-pitch">
                {teamForm.logoDataUrl ? (
                  <img src={teamForm.logoDataUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Icon name="team" className="h-7 w-7" />
                )}
              </div>
              <label className="min-w-0 flex-1">
                <span className="tactical-label">Logo</span>
                <input className="block w-full text-xs font-semibold text-tactical-ash" type="file" accept="image/*" onChange={handleLogoUpload} />
              </label>
            </div>

            <label className="mt-4 block">
              <span className="tactical-label">Nome do clube</span>
              <input
                className="tactical-input"
                value={teamForm.name}
                onChange={(event) => updateTeamField('name', event.target.value)}
                maxLength={120}
                required
              />
            </label>

            <label className="mt-4 block">
              <span className="tactical-label">Cidade</span>
              <input
                className="tactical-input"
                value={teamForm.city}
                onChange={(event) => updateTeamField('city', event.target.value)}
                maxLength={120}
              />
            </label>

            <button type="submit" className="tactical-button mt-4 w-full" disabled={creatingTeam}>
              {creatingTeam ? 'Criando...' : 'Criar clube'}
            </button>
          </form>
        </aside>
      </section>
    ) : (
      <section className="grid gap-5">
        <article className="tactical-panel px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-tactical-pitch/10 text-tactical-pitch">
              <Icon name="team" className="h-7 w-7" />
            </div>
            <div>
              <span className="tactical-label mb-0">Sem clube</span>
              <h1 className="text-2xl font-black tracking-tight text-tactical-ink">Solicitar entrada</h1>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-tactical-ash">
            Procure o clube abaixo e envie uma solicitacao. Um admin ou treinador precisa aprovar antes do acesso aos videos.
          </p>
        </article>

        <section className="tactical-panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-tactical-ink/10 px-5 py-4">
            <div>
              <span className="tactical-label mb-0">Clubes</span>
              <h2 className="text-xl font-black tracking-tight text-tactical-ink">Disponiveis</h2>
            </div>
            <span className="rounded-full bg-tactical-pitch/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-tactical-pitch">
              {availableTeams.length} clube{availableTeams.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="grid gap-3 px-5 py-5">
            {availableTeams.map((team) => (
              <article
                key={team.id}
                className="grid gap-3 rounded-xl border border-tactical-line/35 bg-white p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
              >
                <TeamLogo team={team} className="h-12 w-12" roundedClassName="rounded-xl" />
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-black text-tactical-ink">{team.name}</strong>
                  <span className="mt-1 block truncate text-xs font-semibold text-tactical-ash">{team.city || 'Cidade nao informada'}</span>
                </div>
                <button
                  type="button"
                  className="tactical-button h-11 px-4"
                  disabled={team.pendingJoinRequest || requestingJoinTeamId === team.id}
                  onClick={() => requestJoinTeam(team.id)}
                >
                  {team.pendingJoinRequest ? 'Solicitado' : requestingJoinTeamId === team.id ? 'Enviando...' : 'Solicitar'}
                </button>
              </article>
            ))}

            {!availableTeams.length ? (
              <div className="rounded-xl border border-dashed border-tactical-ink/15 px-4 py-8 text-center">
                <strong className="text-sm font-black uppercase tracking-[0.16em] text-tactical-ink">Nenhum clube disponivel</strong>
              </div>
            ) : null}
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className={cn('grid gap-6', canCreateTeam ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : 'xl:grid-cols-1')}>
      <div className="space-y-6">
        <article className="tactical-panel overflow-hidden">
          <div
            className="field-grid relative min-h-[220px] overflow-hidden bg-tactical-ink bg-cover bg-center sm:min-h-[280px]"
            style={
              activeTeam?.coverDataUrl
                ? {
                    backgroundImage: `linear-gradient(180deg, rgba(0, 34, 68, 0.12), rgba(0, 34, 68, 0.64)), url(${activeTeam.coverDataUrl})`
                  }
                : undefined
            }
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(63,143,41,0.28),transparent_28%),linear-gradient(135deg,rgba(0,34,68,0.12),rgba(0,34,68,0.9))]" />
          </div>

          <div className="relative px-5 pb-5 sm:px-7 sm:pb-7">
            <div className="relative z-10 -mt-20 flex flex-col gap-4 sm:-mt-24 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end">
                <TeamLogo
                  team={activeTeam}
                  className="h-32 w-32 border-4 border-white sm:h-40 sm:w-40"
                  roundedClassName="rounded-full"
                />
                <div className="min-w-0 pb-1">
                  <span className="block text-[0.68rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Clube</span>
                  <h1 className="mt-1 truncate text-3xl font-black uppercase tracking-[0.08em] text-tactical-ink sm:text-4xl">
                    {activeTeam?.name || 'Sem time'}
                  </h1>
                  <span className="mt-1 block truncate text-sm font-semibold text-tactical-ash">
                    {activeTeam?.city || 'Cidade nao informada'}
                  </span>
                </div>
              </div>
              {activeTeam ? (
                <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
                  {canEditEvents || !authUser?.globalAdmin ? (
                    <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
                      {canEditEvents ? (
                        <Link
                          to="/club-manage"
                          className="relative inline-flex h-11 items-center justify-center gap-2 rounded-full bg-tactical-ink px-4 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-tactical-pitch"
                        >
                          <Icon name="settings" className="h-4 w-4" />
                          Configuracoes
                          {clubNotificationsCount > 0 ? (
                            <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-tactical-pitch px-1.5 text-[0.62rem] leading-none text-white">
                              {clubNotificationsCount}
                            </span>
                          ) : null}
                        </Link>
                      ) : null}

                      {!authUser?.globalAdmin ? (
                        <>
                          <select
                            className="h-11 min-w-[150px] rounded-full border border-tactical-pitch/20 bg-tactical-pitch/10 px-4 text-xs font-black uppercase tracking-[0.14em] text-tactical-pitch outline-none transition focus:border-tactical-pitch"
                            value={teamRoleDraft || activeTeam.role}
                            onChange={(event) => setTeamRoleDraft(event.target.value)}
                          >
                            {ROLE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>

                          {hasRoleDraftChange ? (
                            <button
                              type="button"
                              className="h-11 rounded-full bg-tactical-pitch px-4 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-tactical-ink disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={requestingRoleChange}
                              onClick={saveTeamRoleDraft}
                            >
                              {requestingRoleChange ? 'Salvando...' : 'Salvar'}
                            </button>
                          ) : null}

                          <button
                            type="button"
                            className="h-11 rounded-full border border-red-300 bg-red-50 px-4 text-xs font-black uppercase tracking-[0.16em] text-red-700 transition hover:border-red-500 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={leavingTeam}
                            onClick={leaveActiveTeam}
                          >
                            {leavingTeam ? 'Saindo...' : 'Sair do time'}
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </article>

        <div className="grid gap-5 xl:grid-cols-[minmax(220px,20%)_minmax(0,1fr)]">
          <aside className="xl:sticky xl:top-28 xl:self-start">
            <article className="tactical-panel px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-tactical-pitch/10 text-tactical-pitch">
                  <Icon name="clock" className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[0.62rem] font-black uppercase tracking-[0.18em] text-tactical-ash">Eventos</span>
                  <h2 className="truncate text-lg font-black text-tactical-ink">Eventos proximos</h2>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                {upcomingEvents.map((event) => (
                  <div key={event.id} className="rounded-xl border border-tactical-line/35 bg-tactical-bone/35 px-3 py-3">
                    <strong className="block text-sm font-black leading-5 text-tactical-ink">{event.title}</strong>
                    <span className="mt-1 block text-xs font-black uppercase tracking-[0.14em] text-tactical-ash">
                      {formatEventDate(event.startsAt)}
                    </span>
                    {event.location ? (
                      <span className="mt-1 block text-xs font-semibold text-tactical-ash">{event.location}</span>
                    ) : null}
                    {canEditEvents ? (
                      <button
                        type="button"
                        className="mt-3 rounded-lg border border-tactical-ink/10 px-2.5 py-1.5 text-[0.62rem] font-black uppercase tracking-[0.14em] text-tactical-ash transition hover:border-tactical-pitch/35 hover:text-tactical-pitch"
                        disabled={savingEvents}
                        onClick={() => removeEvent(event.id)}
                      >
                        Remover
                      </button>
                    ) : null}
                  </div>
                ))}

                {!upcomingEvents.length ? (
                  <div className="rounded-xl border border-dashed border-tactical-ink/15 bg-tactical-bone/35 px-3 py-6 text-sm font-semibold leading-6 text-tactical-ash">
                    Nenhum evento futuro cadastrado.
                  </div>
                ) : null}
              </div>

              {canEditEvents ? (
                <form className="mt-4 grid gap-3 border-t border-tactical-ink/10 pt-4" onSubmit={addEvent}>
                  <label className="block">
                    <span className="tactical-label">Evento</span>
                    <input
                      className="tactical-input"
                      value={eventForm.title}
                      onChange={(event) => updateEventField('title', event.target.value)}
                      maxLength={120}
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="tactical-label">Data</span>
                    <input
                      className="tactical-input"
                      value={eventForm.startsAt}
                      onChange={(event) => updateEventField('startsAt', event.target.value)}
                      type="datetime-local"
                    />
                  </label>
                  <label className="block">
                    <span className="tactical-label">Local</span>
                    <input
                      className="tactical-input"
                      value={eventForm.location}
                      onChange={(event) => updateEventField('location', event.target.value)}
                      maxLength={120}
                    />
                  </label>
                  <button type="submit" className="tactical-button w-full" disabled={savingEvents}>
                    {savingEvents ? 'Salvando...' : 'Adicionar'}
                  </button>
                </form>
              ) : null}
            </article>

            {canEditOwnAthleteProfile ? (
              <form className="tactical-panel mt-5 px-4 py-4" onSubmit={saveAthleteProfile}>
                <span className="tactical-label">Meus dados no clube</span>
                <div className="mt-3 grid gap-3">
                  <label className="block">
                    <span className="tactical-label">Apelido</span>
                    <input
                      className="tactical-input"
                      value={athleteProfileForm.nickname}
                      onChange={(event) => updateAthleteProfileField('nickname', event.target.value)}
                      maxLength={80}
                    />
                  </label>

                  <label className="block">
                    <span className="tactical-label">Camisa</span>
                    <input
                      className="tactical-input"
                      value={athleteProfileForm.jerseyNumber}
                      onChange={(event) => updateAthleteProfileField('jerseyNumber', event.target.value)}
                      maxLength={12}
                    />
                  </label>

                  <label className="block">
                    <span className="tactical-label">Setor</span>
                    <select
                      className="tactical-input"
                      value={athleteProfileForm.sector}
                      onChange={(event) => updateAthleteProfileSector(event.target.value)}
                    >
                      {SECTOR_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="tactical-label">Posicao</span>
                    <select
                      className="tactical-input"
                      value={athleteProfileForm.position}
                      onChange={(event) => updateAthleteProfileField('position', event.target.value)}
                    >
                      <option value="">Selecionar</option>
                      {athletePositionOptions.map((position) => (
                        <option key={position} value={position}>
                          {position}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="submit"
                    className="tactical-button w-full"
                    disabled={savingAthleteProfile || !athleteProfileChanged}
                  >
                    {savingAthleteProfile ? 'Salvando...' : 'Salvar meus dados'}
                  </button>
                </div>
              </form>
            ) : null}

          </aside>

          {activeTeam ? (
            <section className="tactical-panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-tactical-ink/10 px-5 py-4">
                <div>
                  <span className="tactical-label mb-1">Elenco</span>
                  <h2 className="text-2xl font-black tracking-tight text-tactical-ink">Membros do clube</h2>
                </div>
                <span className="rounded-full bg-tactical-pitch/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-tactical-pitch">
                  {activeTeam.loading ? 'Carregando' : `${activeMembers.length} membros`}
                </span>
              </div>

              <div className="px-5 py-5">
                {activeMembers.length ? (
                  <div className="overflow-x-auto rounded-xl border border-tactical-line/40 bg-white">
                    <table className="w-full min-w-[920px] border-collapse text-left">
                      <thead className="bg-tactical-bone/80">
                        <tr>
                          <th className={ROSTER_TABLE_LABEL_CLASS}>Membro</th>
                          <th className={ROSTER_TABLE_LABEL_CLASS}>Funcao</th>
                          <th className={ROSTER_TABLE_LABEL_CLASS}>Camisa</th>
                          <th className={ROSTER_TABLE_LABEL_CLASS}>Apelido</th>
                          <th className={ROSTER_TABLE_LABEL_CLASS}>Setor</th>
                          <th className={ROSTER_TABLE_LABEL_CLASS}>Posicao</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeMembers.map((member) => {
                          const memberRole = normalizeRole(member.role);
                          const isAthlete = memberRole === 'atleta';
                          const sector = member.sector || sectorForPosition(member.position);

                          return (
                            <tr key={member.id} className="bg-white transition hover:bg-tactical-bone/45">
                              <td className={ROSTER_TABLE_CELL_CLASS}>
                                <div className="flex min-w-0 items-center gap-3">
                                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-tactical-ink text-xs font-black text-white">
                                    {member.initials || member.name?.slice(0, 2).toUpperCase() || 'U'}
                                  </div>
                                  <div className="min-w-0">
                                    <strong className="block truncate text-sm font-black text-tactical-ink">{member.name}</strong>
                                    <span className="block truncate text-xs font-semibold text-tactical-ash">{member.email}</span>
                                  </div>
                                </div>
                              </td>
                              <td className={ROSTER_TABLE_CELL_CLASS}>
                                <span
                                  className={cn(
                                    'inline-flex rounded-full px-2.5 py-1 text-[0.58rem] font-black uppercase tracking-[0.12em]',
                                    memberRole === 'admin' ? 'bg-tactical-pitch text-white' : 'bg-tactical-bone text-tactical-ink'
                                  )}
                                >
                                  {roleLabel(member.role)}
                                </span>
                              </td>
                              <td className={ROSTER_TABLE_CELL_CLASS}>{isAthlete ? member.jerseyNumber || '-' : '-'}</td>
                              <td className={ROSTER_TABLE_CELL_CLASS}>{isAthlete ? member.nickname || '-' : '-'}</td>
                              <td className={ROSTER_TABLE_CELL_CLASS}>{isAthlete ? sectorLabel(sector) || '-' : '-'}</td>
                              <td className={ROSTER_TABLE_CELL_CLASS}>{isAthlete ? member.position || '-' : '-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {!activeMembers.length && !activeTeam.loading ? (
                  <div className="rounded-xl border border-dashed border-tactical-ink/15 px-4 py-8 text-center">
                    <strong className="text-sm font-black uppercase tracking-[0.16em] text-tactical-ink">Sem membros carregados</strong>
                  </div>
                ) : null}
              </div>
            </section>
          ) : (
            <section className="tactical-panel px-6 py-10 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-tactical-pitch/10 text-tactical-pitch">
                <Icon name="team" className="h-7 w-7" />
              </div>
              <strong className="mt-4 block text-sm font-black uppercase tracking-[0.16em] text-tactical-ink">
                Nenhum clube vinculado
              </strong>
            </section>
          )}
        </div>
      </div>

      {canCreateTeam ? (
        <aside className="space-y-5 self-start">
          <form className="tactical-panel px-5 py-5" onSubmit={createTeam}>
            <span className="tactical-label">Novo time</span>
            <h2 className="text-xl font-black tracking-tight text-tactical-ink">Criar clube</h2>

            <div className="mt-4 flex items-center gap-3 rounded-xl border border-tactical-line/35 bg-tactical-bone/55 px-3 py-3">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-tactical-ink/10 bg-white text-tactical-pitch">
                {teamForm.logoDataUrl ? (
                  <img src={teamForm.logoDataUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Icon name="team" className="h-7 w-7" />
                )}
              </div>
              <label className="min-w-0 flex-1">
                <span className="tactical-label">Logo do time</span>
                <input className="block w-full text-xs font-semibold text-tactical-ash" type="file" accept="image/*" onChange={handleLogoUpload} />
              </label>
            </div>

            <label className="mt-4 block">
              <span className="tactical-label">Nome do time</span>
              <input
                className="tactical-input"
                value={teamForm.name}
                onChange={(event) => updateTeamField('name', event.target.value)}
                maxLength={120}
                required
              />
            </label>

            <label className="mt-4 block">
              <span className="tactical-label">Cidade</span>
              <input
                className="tactical-input"
                value={teamForm.city}
                onChange={(event) => updateTeamField('city', event.target.value)}
                maxLength={120}
              />
            </label>

            <div className="mt-4 grid gap-3">
              <span className="tactical-label mb-0">Midias sociais</span>
              <input
                className="tactical-input"
                value={teamForm.socialLinks.instagram}
                onChange={(event) => updateSocialLink('instagram', event.target.value)}
                placeholder="Instagram"
                maxLength={300}
              />
              <input
                className="tactical-input"
                value={teamForm.socialLinks.website}
                onChange={(event) => updateSocialLink('website', event.target.value)}
                placeholder="Site"
                maxLength={300}
              />
              <input
                className="tactical-input"
                value={teamForm.socialLinks.facebook}
                onChange={(event) => updateSocialLink('facebook', event.target.value)}
                placeholder="Facebook"
                maxLength={300}
              />
              <input
                className="tactical-input"
                value={teamForm.socialLinks.x}
                onChange={(event) => updateSocialLink('x', event.target.value)}
                placeholder="X / Twitter"
                maxLength={300}
              />
            </div>

            <button type="submit" className="tactical-button mt-4 w-full" disabled={creatingTeam}>
              {creatingTeam ? 'Criando...' : 'Criar clube'}
            </button>
          </form>
        </aside>
      ) : null}
    </section>
  );
}
