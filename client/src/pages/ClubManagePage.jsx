import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icons';
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

const EMPTY_INVITE_FORM = {
  email: '',
  role: 'atleta'
};

const SECTOR_OPTIONS = [
  { value: 'ataque', label: 'Ataque', positions: ['QB', 'RB', 'WR', 'TE', 'OL'] },
  { value: 'defesa', label: 'Defesa', positions: ['DL', 'LB', 'DB'] },
  { value: 'special-teams', label: 'Special Teams', positions: ['K/P'] }
];

const MEMBER_POSITION_OPTIONS = SECTOR_OPTIONS.flatMap((option) => option.positions);

const MEMBER_SORT_OPTIONS = [
  { value: 'name', label: 'Nome' },
  { value: 'lastName', label: 'Sobrenome' },
  { value: 'nickname', label: 'Apelido' },
  { value: 'jerseyNumber', label: 'Camisa' },
  { value: 'sector', label: 'Setor' },
  { value: 'position', label: 'Posicao' },
  { value: 'role', label: 'Funcao' }
];

const MEMBER_COMPARE_FIELDS = ['firstName', 'lastName', 'nickname', 'jerseyNumber', 'sector', 'position', 'role'];
const MEMBER_TABLE_INPUT_CLASS =
  'h-10 w-full rounded-lg border border-tactical-ink/10 bg-white px-3 text-sm font-semibold text-tactical-ink outline-none transition focus:border-tactical-pitch disabled:bg-tactical-bone disabled:text-tactical-ash';
const MEMBER_TABLE_LABEL_CLASS = 'px-2 py-2 text-[0.62rem] font-black uppercase tracking-[0.16em] text-tactical-ash';
const MEMBER_TABLE_CELL_CLASS = 'border-b border-tactical-line/35 px-2 py-2 align-middle';
const MAX_COVER_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_LOGO_BYTES = 700 * 1024;
const COVER_PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function roleLabel(role) {
  return ROLE_LABELS[role] || role || 'Membro';
}

function canManageRole(role, authUser) {
  return Boolean(authUser?.globalAdmin || isTeamManagerRole(role));
}

function canInviteRole(inviterRole, targetRole, authUser) {
  const normalizedInviterRole = normalizeRole(inviterRole);
  const normalizedTargetRole = normalizeRole(targetRole);
  if (authUser?.globalAdmin || normalizedInviterRole === 'admin') {
    return true;
  }

  return normalizedInviterRole === 'treinador' && normalizedTargetRole !== 'admin';
}

function sectorLabel(sector) {
  return SECTOR_OPTIONS.find((option) => option.value === sector)?.label || sector || '';
}

function sectorForPosition(position) {
  const normalizedPosition = String(position || '').toUpperCase();
  return SECTOR_OPTIONS.find((option) => option.positions.includes(normalizedPosition))?.value || '';
}

function positionsForSector(sector) {
  return SECTOR_OPTIONS.find((option) => option.value === sector)?.positions || [];
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Nao foi possivel carregar a imagem.'));
    reader.readAsDataURL(file);
  });
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

function initialMember(member) {
  const role = normalizeRole(member.role) || 'atleta';
  const isAthlete = role === 'atleta';
  const sector = isAthlete ? member.sector || sectorForPosition(member.position) || 'ataque' : '';
  const positions = positionsForSector(sector);
  const position =
    isAthlete && positions.includes(String(member.position || '').toUpperCase()) ? String(member.position || '').toUpperCase() : '';

  return {
    ...member,
    firstName: member.firstName || member.name?.split(' ')[0] || '',
    lastName: member.lastName || member.name?.split(' ').slice(1).join(' ') || '',
    nickname: isAthlete ? member.nickname || '' : '',
    jerseyNumber: isAthlete ? member.jerseyNumber || '' : '',
    sector,
    position,
    role
  };
}

function memberSignature(member) {
  return JSON.stringify(MEMBER_COMPARE_FIELDS.map((field) => String(member?.[field] ?? '')));
}

function memberBaselineMap(members) {
  return (Array.isArray(members) ? members : []).reduce((baselines, member) => {
    baselines[member.id] = memberSignature(member);
    return baselines;
  }, {});
}

function memberSortValue(member, field) {
  if (field === 'name') {
    return `${member.firstName || ''} ${member.lastName || ''}`.trim() || member.name || '';
  }

  if (field === 'role') {
    return roleLabel(member.role);
  }

  if (field === 'sector') {
    return sectorLabel(member.sector);
  }

  return member[field] || '';
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function memberSearchText(member) {
  return normalizeSearchText(
    [
      memberSortValue(member, 'name'),
      member.firstName,
      member.lastName,
      member.name,
      member.email,
      member.nickname,
      member.jerseyNumber,
      sectorLabel(member.sector),
      member.position,
      roleLabel(member.role)
    ].join(' ')
  );
}

function compareMembers(left, right, field, direction) {
  const result = String(memberSortValue(left, field)).localeCompare(String(memberSortValue(right, field)), 'pt-BR', {
    numeric: true,
    sensitivity: 'base'
  });

  if (result !== 0) {
    return direction === 'asc' ? result : -result;
  }

  return String(left.id || '').localeCompare(String(right.id || ''), 'pt-BR');
}

export function ClubManagePage({ authUser, showToast, onAuthRefresh, onNotificationsRefresh }) {
  const [team, setTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [memberBaselines, setMemberBaselines] = useState({});
  const [invites, setInvites] = useState([]);
  const [inviteForm, setInviteForm] = useState(EMPTY_INVITE_FORM);
  const [joinRequests, setJoinRequests] = useState([]);
  const [roleChangeRequests, setRoleChangeRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingCover, setSavingCover] = useState(false);
  const [savingLogo, setSavingLogo] = useState(false);
  const [deletingTeam, setDeletingTeam] = useState(false);
  const [savingMembers, setSavingMembers] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [deletingInviteId, setDeletingInviteId] = useState('');
  const [approvingJoinRequestId, setApprovingJoinRequestId] = useState('');
  const [approvingRoleChangeRequestId, setApprovingRoleChangeRequestId] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberSectorFilter, setMemberSectorFilter] = useState('');
  const [memberPositionFilter, setMemberPositionFilter] = useState('');
  const [memberSortField, setMemberSortField] = useState('name');
  const [memberSortDirection, setMemberSortDirection] = useState('asc');

  useEffect(() => {
    let ignore = false;

    async function fetchTeamWithMembers(teamId, role = 'admin') {
      const [teamResponse, membersResponse] = await Promise.all([
        authFetch(`/api/teams/${encodeURIComponent(teamId)}`),
        authFetch(`/api/teams/${encodeURIComponent(teamId)}/members`)
      ]);
      const teamPayload = await teamResponse.json().catch(() => ({}));
      const membersPayload = await membersResponse.json().catch(() => ({}));

      if (!teamResponse.ok || !membersResponse.ok) {
        throw new Error(teamPayload.error || membersPayload.error || 'Nao foi possivel carregar o clube.');
      }

      return {
        team: {
          ...teamPayload.team,
          role: normalizeRole(role) || role
        },
        members: (membersPayload.members || []).map(initialMember)
      };
    }

    async function loadClub() {
      setLoading(true);
      try {
        const membership =
          (authUser?.teamMemberships || []).find((item) => canManageRole(item.role, authUser)) ||
          (authUser?.teamMemberships || [])[0];

        if (membership?.teamId) {
          const result = await fetchTeamWithMembers(membership.teamId, membership.role);
          const canReviewRoleChangeRequests = canManageRole(result.team.role, authUser);
          const [invitesPayload, joinRequestsPayload, roleRequestsPayload] = await Promise.all([
            canManageRole(result.team.role, authUser)
              ? authFetch(`/api/teams/${encodeURIComponent(result.team.id)}/invites`).then((response) =>
                  response.json().then((payload) => {
                    if (!response.ok) {
                      throw new Error(payload.error || 'Nao foi possivel carregar convites.');
                    }
                    return payload;
                  })
                )
              : Promise.resolve({ invites: [] }),
            canManageRole(result.team.role, authUser)
              ? authFetch(`/api/teams/${encodeURIComponent(result.team.id)}/join-requests`).then((response) =>
                  response.json().then((payload) => {
                    if (!response.ok) {
                      throw new Error(payload.error || 'Nao foi possivel carregar pedidos de entrada.');
                    }
                    return payload;
                  })
                )
              : Promise.resolve({ requests: [] }),
            canReviewRoleChangeRequests
              ? authFetch(`/api/teams/${encodeURIComponent(result.team.id)}/role-change-requests`).then((response) =>
                  response.json().then((payload) => {
                    if (!response.ok) {
                      throw new Error(payload.error || 'Nao foi possivel carregar solicitacoes de funcao.');
                    }
                    return payload;
                  })
                )
              : Promise.resolve({ requests: [] })
          ]);

          if (!ignore) {
            setTeam(result.team);
            setMembers(result.members);
            setMemberBaselines(memberBaselineMap(result.members));
            setInvites(invitesPayload.invites || []);
            setJoinRequests(joinRequestsPayload.requests || []);
            setRoleChangeRequests(roleRequestsPayload.requests || []);
          }
          return;
        }

        if (authUser?.globalAdmin) {
          const response = await authFetch('/api/teams');
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.error || 'Nao foi possivel carregar clubes.');
          }
          const firstTeam = (payload.teams || [])[0];
          if (!firstTeam) {
            if (!ignore) {
              setTeam(null);
              setMembers([]);
              setMemberBaselines({});
              setInvites([]);
              setJoinRequests([]);
              setRoleChangeRequests([]);
            }
            return;
          }
          const result = await fetchTeamWithMembers(firstTeam.id, 'admin');
          const [invitesPayload, joinRequestsPayload, roleRequestsPayload] = await Promise.all([
            authFetch(`/api/teams/${encodeURIComponent(result.team.id)}/invites`).then((response) =>
              response.json().then((payload) => {
                if (!response.ok) {
                  throw new Error(payload.error || 'Nao foi possivel carregar convites.');
                }
                return payload;
              })
            ),
            authFetch(`/api/teams/${encodeURIComponent(result.team.id)}/join-requests`).then((response) =>
              response.json().then((payload) => {
                if (!response.ok) {
                  throw new Error(payload.error || 'Nao foi possivel carregar pedidos de entrada.');
                }
                return payload;
              })
            ),
            authFetch(`/api/teams/${encodeURIComponent(result.team.id)}/role-change-requests`).then((response) =>
              response.json().then((payload) => {
                if (!response.ok) {
                  throw new Error(payload.error || 'Nao foi possivel carregar solicitacoes de funcao.');
                }
                return payload;
              })
            )
          ]);
          if (!ignore) {
            setTeam(result.team);
            setMembers(result.members);
            setMemberBaselines(memberBaselineMap(result.members));
            setInvites(invitesPayload.invites || []);
            setJoinRequests(joinRequestsPayload.requests || []);
            setRoleChangeRequests(roleRequestsPayload.requests || []);
          }
        }
      } catch (error) {
        if (!ignore) {
          showToast(error.message);
          setTeam(null);
          setMembers([]);
          setMemberBaselines({});
          setInvites([]);
          setJoinRequests([]);
          setRoleChangeRequests([]);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadClub();
    return () => {
      ignore = true;
    };
  }, [authUser, showToast]);

  const canManage = canManageRole(team?.role, authUser);
  const canEditTeamBranding = Boolean(authUser?.globalAdmin || normalizeRole(team?.role) === 'admin');
  const canDeleteTeam = Boolean(authUser?.globalAdmin || normalizeRole(team?.role) === 'admin');
  const inviteRoleOptions = ROLE_OPTIONS.filter((option) => canInviteRole(team?.role, option.value, authUser));
  const adminCount = members.filter((member) => normalizeRole(member.role) === 'admin').length;
  const hasMemberFilters = Boolean(memberSearch.trim() || memberSectorFilter || memberPositionFilter);
  const memberPositionFilterOptions = memberSectorFilter ? positionsForSector(memberSectorFilter) : MEMBER_POSITION_OPTIONS;
  const sortedMembers = useMemo(() => {
    const query = normalizeSearchText(memberSearch);
    const visibleMembers = members.filter((member) => {
      if (memberSectorFilter && member.sector !== memberSectorFilter) {
        return false;
      }

      if (memberPositionFilter && String(member.position || '').toUpperCase() !== memberPositionFilter) {
        return false;
      }

      return query ? memberSearchText(member).includes(query) : true;
    });

    return [...visibleMembers].sort((left, right) => compareMembers(left, right, memberSortField, memberSortDirection));
  }, [memberPositionFilter, memberSearch, memberSectorFilter, memberSortDirection, memberSortField, members]);
  const changedMembers = useMemo(
    () => members.filter((member) => Boolean(memberBaselines[member.id] && memberSignature(member) !== memberBaselines[member.id])),
    [memberBaselines, members]
  );
  const hasMemberChanges = changedMembers.length > 0;

  function updateMemberField(memberId, field, value) {
    setMembers((current) =>
      current.map((member) =>
        member.id === memberId
          ? {
              ...member,
              [field]: value
            }
          : member
      )
    );
  }

  function updateMemberSector(memberId, sector) {
    setMembers((current) =>
      current.map((member) =>
        member.id === memberId
          ? {
              ...member,
              sector,
              position: positionsForSector(sector).includes(member.position) ? member.position : ''
            }
          : member
      )
    );
  }

  function updateMemberSectorFilter(sector) {
    setMemberSectorFilter(sector);
    setMemberPositionFilter((current) => (sector && current && !positionsForSector(sector).includes(current) ? '' : current));
  }

  function updateMemberRole(memberId, role) {
    setMembers((current) =>
      current.map((member) =>
        member.id === memberId
          ? {
              ...member,
              role,
              nickname: role === 'atleta' ? member.nickname : '',
              jerseyNumber: role === 'atleta' ? member.jerseyNumber : '',
              sector: role === 'atleta' ? member.sector || 'ataque' : '',
              position: role === 'atleta' ? member.position : ''
            }
          : member
      )
    );
  }

  function mergeUpdatedTeam(updatedTeam) {
    setTeam((current) =>
      current?.id === updatedTeam?.id
        ? {
            ...current,
            ...updatedTeam,
            role: current.role
          }
        : current
    );
  }

  async function saveCoverPhoto(coverDataUrl, successMessage) {
    if (!team?.id || !canEditTeamBranding) {
      return;
    }

    setSavingCover(true);
    try {
      const response = await authFetch(`/api/teams/${encodeURIComponent(team.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ coverDataUrl })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel salvar a foto de fundo.');
      }

      mergeUpdatedTeam(payload.team);
      showToast(successMessage);
    } catch (error) {
      showToast(error.message);
    } finally {
      setSavingCover(false);
    }
  }

  async function saveClubLogo(logoDataUrl, successMessage) {
    if (!team?.id || !canEditTeamBranding) {
      return;
    }

    setSavingLogo(true);
    try {
      const response = await authFetch(`/api/teams/${encodeURIComponent(team.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ logoDataUrl })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel salvar a foto do clube.');
      }

      mergeUpdatedTeam(payload.team);
      showToast(successMessage);
    } catch (error) {
      showToast(error.message);
    } finally {
      setSavingLogo(false);
    }
  }

  async function handleClubLogoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      showToast('Selecione uma imagem valida para o logo.');
      event.target.value = '';
      return;
    }

    if (file.size > MAX_LOGO_BYTES) {
      showToast('Use um logo com ate 700 KB.');
      event.target.value = '';
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      await saveClubLogo(dataUrl, 'Foto do clube atualizada.');
    } catch (error) {
      showToast(error.message);
    } finally {
      event.target.value = '';
    }
  }

  async function handleCoverUpload(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!COVER_PHOTO_TYPES.has(file.type)) {
      showToast('Use uma imagem PNG, JPG ou WebP.');
      event.target.value = '';
      return;
    }

    if (file.size > MAX_COVER_PHOTO_BYTES) {
      showToast('Use uma foto de fundo com ate 2 MB.');
      event.target.value = '';
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      await saveCoverPhoto(dataUrl, 'Foto de fundo atualizada.');
    } catch (error) {
      showToast(error.message);
    } finally {
      event.target.value = '';
    }
  }

  async function deleteTeam() {
    if (!team?.id || deletingTeam) {
      return;
    }

    if (!canDeleteTeam) {
      showToast('Apenas admin pode excluir o clube.');
      return;
    }

    const confirmed = window.confirm(`Excluir o time "${team.name}"? Esta acao tambem remove videos, playlists e eventos vinculados a ele.`);
    if (!confirmed) {
      return;
    }

    setDeletingTeam(true);
    try {
      const response = await authFetch(`/api/teams/${encodeURIComponent(team.id)}`, {
        method: 'DELETE'
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel excluir o time.');
      }

      setTeam(null);
      setMembers([]);
      setMemberBaselines({});
      setInvites([]);
      setJoinRequests([]);
      setRoleChangeRequests([]);
      await onAuthRefresh?.();
      showToast('Time excluido.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setDeletingTeam(false);
    }
  }

  async function saveChangedMembers() {
    if (!team?.id || !canManage || !changedMembers.length || savingMembers) {
      return;
    }

    setSavingMembers(true);
    try {
      for (const member of changedMembers) {
        const response = await authFetch(`/api/teams/${encodeURIComponent(team.id)}/members/${encodeURIComponent(member.id)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            firstName: member.firstName,
            lastName: member.lastName,
            nickname: member.nickname,
            jerseyNumber: member.jerseyNumber,
            sector: member.sector,
            position: member.position,
            role: member.role
          })
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload.error || 'Nao foi possivel salvar o membro.');
        }

        const savedMember = initialMember(payload.member);
        setMembers((current) => current.map((item) => (item.id === member.id ? savedMember : item)));
        setMemberBaselines((current) => ({
          ...current,
          [savedMember.id]: memberSignature(savedMember)
        }));
      }
      showToast(`${changedMembers.length} membro${changedMembers.length > 1 ? 's' : ''} atualizado${changedMembers.length > 1 ? 's' : ''}.`);
    } catch (error) {
      showToast(error.message);
    } finally {
      setSavingMembers(false);
    }
  }

  async function createInvite(event) {
    event.preventDefault();

    if (!team?.id || creatingInvite) {
      return;
    }

    const email = inviteForm.email.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      showToast('Informe um email valido para o convite.');
      return;
    }

    setCreatingInvite(true);
    try {
      const response = await authFetch(`/api/teams/${encodeURIComponent(team.id)}/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          role: inviteForm.role
        })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel criar o convite.');
      }

      setInvites((current) => [payload.invite, ...current.filter((invite) => invite.id !== payload.invite?.id)]);
      setInviteForm(EMPTY_INVITE_FORM);
      showToast('Convite criado.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setCreatingInvite(false);
    }
  }

  async function deleteInvite(invite) {
    if (!team?.id || !invite?.id || deletingInviteId) {
      return;
    }

    setDeletingInviteId(invite.id);
    try {
      const response = await authFetch(`/api/teams/${encodeURIComponent(team.id)}/invites/${encodeURIComponent(invite.id)}`, {
        method: 'DELETE'
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel cancelar o convite.');
      }

      setInvites((current) => current.filter((item) => item.id !== invite.id));
      showToast('Convite cancelado.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setDeletingInviteId('');
    }
  }

  async function approveJoinRequest(request) {
    if (!team?.id || !request?.id) {
      return;
    }

    setApprovingJoinRequestId(request.id);
    try {
      const response = await authFetch(`/api/teams/${encodeURIComponent(team.id)}/join-requests/${encodeURIComponent(request.id)}/approve`, {
        method: 'POST'
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel aprovar a entrada.');
      }

      const updatedMember = initialMember(payload.member);
      setJoinRequests((current) => current.filter((item) => item.id !== request.id));
      setMembers((current) => [...current.filter((member) => member.id !== updatedMember.id), updatedMember]);
      setMemberBaselines((current) => ({
        ...current,
        [updatedMember.id]: memberSignature(updatedMember)
      }));
      await onNotificationsRefresh?.();
      showToast('Membro adicionado ao clube.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setApprovingJoinRequestId('');
    }
  }

  async function approveRoleChangeRequest(request) {
    if (!team?.id || !request?.id) {
      return;
    }

    setApprovingRoleChangeRequestId(request.id);
    try {
      const response = await authFetch(`/api/teams/${encodeURIComponent(team.id)}/role-change-requests/${encodeURIComponent(request.id)}/approve`, {
        method: 'POST'
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel aprovar a mudanca.');
      }

      const updatedMember = initialMember(payload.member);
      setRoleChangeRequests((current) => current.filter((item) => item.id !== request.id));
      setMembers((current) => current.map((member) => (member.id === updatedMember.id ? updatedMember : member)));
      setMemberBaselines((current) => ({
        ...current,
        [updatedMember.id]: memberSignature(updatedMember)
      }));
      await onNotificationsRefresh?.();
      showToast('Funcao atualizada.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setApprovingRoleChangeRequestId('');
    }
  }

  if (loading) {
    return (
      <section className="tactical-panel px-6 py-10 text-sm font-semibold uppercase tracking-[0.18em] text-tactical-ash">
        Carregando gestao do clube...
      </section>
    );
  }

  if (!team || !canManage) {
    return (
      <section className="tactical-panel px-6 py-12 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-tactical-pitch/10 text-tactical-pitch">
          <Icon name="settings" className="h-7 w-7" />
        </div>
        <strong className="mt-4 block text-sm font-black uppercase tracking-[0.16em] text-tactical-ink">
          Acesso restrito
        </strong>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-tactical-ash">
          A gestao do clube fica disponivel apenas para treinadores e admins.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <article className="tactical-panel overflow-hidden">
        <div
          className="field-grid relative min-h-[220px] overflow-hidden bg-tactical-ink bg-cover bg-center sm:min-h-[280px]"
          style={
            team.coverDataUrl
              ? {
                  backgroundImage: `linear-gradient(180deg, rgba(0, 34, 68, 0.12), rgba(0, 34, 68, 0.64)), url(${team.coverDataUrl})`
                }
              : undefined
          }
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(63,143,41,0.28),transparent_28%),linear-gradient(135deg,rgba(0,34,68,0.12),rgba(0,34,68,0.9))]" />
          {canEditTeamBranding ? (
            <div className="absolute right-4 top-4 z-10 flex flex-wrap justify-end gap-2">
              <label className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/95 px-3 text-xs font-black uppercase tracking-[0.14em] text-tactical-ink shadow-xl transition hover:border-tactical-pitch/40 hover:text-tactical-pitch">
                <Icon name="upload" className="h-4 w-4" />
                {savingCover ? 'Salvando...' : team?.coverDataUrl ? 'Trocar fundo' : 'Adicionar fundo'}
                <input
                  className="sr-only"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={savingCover}
                  onChange={handleCoverUpload}
                />
              </label>

              {team?.coverDataUrl ? (
                <button
                  type="button"
                  className="min-h-10 rounded-xl border border-white/20 bg-tactical-ink/80 px-3 text-xs font-black uppercase tracking-[0.14em] text-white shadow-xl transition hover:bg-tactical-pitch"
                  disabled={savingCover}
                  onClick={() => saveCoverPhoto('', 'Foto de fundo removida.')}
                >
                  Remover
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="relative px-5 pb-5 sm:px-7 sm:pb-7">
          <div className="relative z-10 -mt-20 flex flex-col gap-4 sm:-mt-24 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end">
              <div className="relative w-fit shrink-0">
                <TeamLogo team={team} className="h-32 w-32 border-4 border-white sm:h-40 sm:w-40" roundedClassName="rounded-full" />
                {canEditTeamBranding ? (
                  <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-1">
                    <label className="inline-flex min-h-9 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white px-3 text-[0.6rem] font-black uppercase tracking-[0.12em] text-tactical-ink shadow-xl transition hover:text-tactical-pitch">
                      {savingLogo ? 'Salvando...' : 'Trocar'}
                      <input className="sr-only" type="file" accept="image/*" disabled={savingLogo} onChange={handleClubLogoUpload} />
                    </label>
                    {team?.logoDataUrl ? (
                      <button
                        type="button"
                        className="min-h-9 rounded-full border border-white/40 bg-tactical-ink/85 px-3 text-[0.6rem] font-black uppercase tracking-[0.12em] text-white shadow-xl transition hover:bg-tactical-pitch"
                        disabled={savingLogo}
                        onClick={() => saveClubLogo('', 'Foto do clube removida.')}
                      >
                        Remover
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="min-w-0 pb-1">
                <span className="block text-[0.68rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Configuracoes</span>
                <h1 className="mt-1 truncate text-3xl font-black uppercase tracking-[0.08em] text-tactical-ink sm:text-4xl">
                  {team.name}
                </h1>
                <span className="mt-1 block truncate text-sm font-semibold text-tactical-ash">
                  {team.city || 'Cidade nao informada'}
                </span>
              </div>
            </div>
            <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
              <div className="w-fit rounded-full bg-tactical-pitch/10 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-tactical-pitch">
                {roleLabel(team.role)}
              </div>
              {canDeleteTeam ? (
                <button
                  type="button"
                  className="h-11 rounded-full border border-red-300 bg-red-50 px-4 text-xs font-black uppercase tracking-[0.16em] text-red-700 transition hover:border-red-500 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={deletingTeam}
                  onClick={deleteTeam}
                >
                  {deletingTeam ? 'Excluindo...' : 'Excluir time'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </article>

      <section className="tactical-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-tactical-ink/10 px-5 py-4">
          <div>
            <span className="tactical-label mb-0">Convites</span>
            <h2 className="text-xl font-black tracking-tight text-tactical-ink">Convidar membro</h2>
          </div>
          <span className="rounded-full bg-tactical-pitch/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-tactical-pitch">
            {invites.length} pendente{invites.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="grid gap-4 px-5 py-5">
          <form className="grid gap-3 rounded-xl border border-tactical-line/35 bg-tactical-bone/35 p-3 lg:grid-cols-[minmax(220px,1fr)_180px_auto] lg:items-end" onSubmit={createInvite}>
            <label className="block">
              <span className="tactical-label">Email</span>
              <input
                className="tactical-input"
                value={inviteForm.email}
                onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="usuario@exemplo.com"
                type="email"
                maxLength={160}
                required
              />
            </label>

            <label className="block">
              <span className="tactical-label">Funcao</span>
              <select
                className="tactical-input"
                value={inviteForm.role}
                onChange={(event) => setInviteForm((current) => ({ ...current, role: event.target.value }))}
              >
                {inviteRoleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button type="submit" className="tactical-button h-11 px-4" disabled={creatingInvite}>
              {creatingInvite ? 'Criando...' : 'Criar convite'}
            </button>
          </form>

          {invites.length ? (
            <div className="overflow-x-auto rounded-xl border border-tactical-line/40 bg-white">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead className="bg-tactical-bone/80">
                  <tr>
                    <th className={MEMBER_TABLE_LABEL_CLASS}>Email</th>
                    <th className={MEMBER_TABLE_LABEL_CLASS}>Funcao</th>
                    <th className={MEMBER_TABLE_LABEL_CLASS}>Codigo</th>
                    <th className={MEMBER_TABLE_LABEL_CLASS}>Expira</th>
                    <th className={MEMBER_TABLE_LABEL_CLASS}>Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((invite) => {
                    const inviteUrl = `${window.location.origin}${invite.registerPath || `/cadastro?convite=${encodeURIComponent(invite.code)}`}`;
                    const expiresAt = invite.expiresAt ? new Date(invite.expiresAt) : null;
                    return (
                      <tr key={invite.id} className="bg-white transition hover:bg-tactical-bone/45">
                        <td className={MEMBER_TABLE_CELL_CLASS}>
                          <span className="block truncate text-sm font-black text-tactical-ink">{invite.email}</span>
                        </td>
                        <td className={MEMBER_TABLE_CELL_CLASS}>{roleLabel(invite.role)}</td>
                        <td className={MEMBER_TABLE_CELL_CLASS}>
                          <div className="flex min-w-0 items-center gap-2">
                            <code className="block max-w-[220px] truncate rounded-lg bg-tactical-bone px-2 py-1 text-xs font-black text-tactical-ink">
                              {invite.code}
                            </code>
                            <button
                              type="button"
                              className="rounded-lg border border-tactical-ink/10 px-2 py-1 text-[0.62rem] font-black uppercase tracking-[0.12em] text-tactical-ash transition hover:border-tactical-pitch/35 hover:text-tactical-pitch"
                              onClick={() => {
                                navigator.clipboard?.writeText(inviteUrl);
                                showToast('Link do convite copiado.');
                              }}
                            >
                              Copiar
                            </button>
                          </div>
                        </td>
                        <td className={MEMBER_TABLE_CELL_CLASS}>
                          {expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toLocaleDateString('pt-BR') : '-'}
                        </td>
                        <td className={MEMBER_TABLE_CELL_CLASS}>
                          <button
                            type="button"
                            className="h-10 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-black uppercase tracking-[0.12em] text-red-700 transition hover:border-red-400 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={deletingInviteId === invite.id}
                            onClick={() => deleteInvite(invite)}
                          >
                            {deletingInviteId === invite.id ? 'Cancelando...' : 'Cancelar'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </section>

      {joinRequests.length ? (
        <section className="tactical-panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-tactical-ink/10 px-5 py-4">
            <div>
              <span className="tactical-label mb-0">Entrada</span>
              <h2 className="text-xl font-black tracking-tight text-tactical-ink">Pedidos para entrar</h2>
            </div>
            <span className="rounded-full bg-tactical-pitch/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-tactical-pitch">
              {joinRequests.length} pendente{joinRequests.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="grid gap-3 px-5 py-5">
            {joinRequests.map((request) => (
              <article
                key={request.id}
                className="grid gap-3 rounded-xl border border-tactical-line/35 bg-tactical-bone/35 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-black text-tactical-ink">{request.user?.name || request.user?.email}</strong>
                  <span className="mt-1 block text-xs font-black uppercase tracking-[0.14em] text-tactical-ash">
                    Entrada como {roleLabel(request.requestedRole || 'atleta')}
                  </span>
                </div>
                <button
                  type="button"
                  className="tactical-button h-11 px-3"
                  disabled={approvingJoinRequestId === request.id}
                  onClick={() => approveJoinRequest(request)}
                >
                  {approvingJoinRequestId === request.id ? 'Aprovando...' : 'Aprovar'}
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {roleChangeRequests.length ? (
        <section className="tactical-panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-tactical-ink/10 px-5 py-4">
            <div>
              <span className="tactical-label mb-0">Funcoes</span>
              <h2 className="text-xl font-black tracking-tight text-tactical-ink">Pedidos de mudanca</h2>
            </div>
            <span className="rounded-full bg-tactical-pitch/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-tactical-pitch">
              {roleChangeRequests.length} pendentes
            </span>
          </div>

          <div className="grid gap-3 px-5 py-5">
            {roleChangeRequests.map((request) => (
              <article
                key={request.id}
                className="grid gap-3 rounded-xl border border-tactical-line/35 bg-tactical-bone/35 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-black text-tactical-ink">{request.user?.name || request.user?.email}</strong>
                  <span className="mt-1 block text-xs font-black uppercase tracking-[0.14em] text-tactical-ash">
                    {roleLabel(request.currentRole)} para {roleLabel(request.requestedRole)}
                  </span>
                </div>
                <button
                  type="button"
                  className="tactical-button h-11 px-3"
                  disabled={approvingRoleChangeRequestId === request.id}
                  onClick={() => approveRoleChangeRequest(request)}
                >
                  {approvingRoleChangeRequestId === request.id ? 'Aprovando...' : 'Aprovar'}
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="tactical-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-tactical-ink/10 px-5 py-4">
          <div>
            <span className="tactical-label mb-0">Membros</span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="flex min-w-[240px] flex-1 items-center gap-2 sm:flex-none">
              <span className="text-[0.62rem] font-black uppercase tracking-[0.14em] text-tactical-ash">Busca</span>
              <input
                className="h-10 w-full rounded-xl border border-tactical-ink/10 bg-white px-3 text-sm font-bold text-tactical-ink outline-none transition placeholder:text-tactical-ash/70 focus:border-tactical-pitch sm:w-64"
                value={memberSearch}
                onChange={(event) => setMemberSearch(event.target.value)}
                placeholder="Nome, email, camisa..."
                maxLength={120}
              />
            </label>
            <label className="flex min-w-[160px] items-center gap-2">
              <span className="text-[0.62rem] font-black uppercase tracking-[0.14em] text-tactical-ash">Setor</span>
              <select
                className="h-10 rounded-xl border border-tactical-ink/10 bg-white px-3 text-xs font-black uppercase tracking-[0.1em] text-tactical-ink outline-none transition focus:border-tactical-pitch"
                value={memberSectorFilter}
                onChange={(event) => updateMemberSectorFilter(event.target.value)}
              >
                <option value="">Todos</option>
                {SECTOR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[150px] items-center gap-2">
              <span className="text-[0.62rem] font-black uppercase tracking-[0.14em] text-tactical-ash">Posicao</span>
              <select
                className="h-10 rounded-xl border border-tactical-ink/10 bg-white px-3 text-xs font-black uppercase tracking-[0.1em] text-tactical-ink outline-none transition focus:border-tactical-pitch"
                value={memberPositionFilter}
                onChange={(event) => setMemberPositionFilter(event.target.value)}
              >
                <option value="">Todas</option>
                {memberPositionFilterOptions.map((position) => (
                  <option key={position} value={position}>
                    {position}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[180px] items-center gap-2">
              <span className="text-[0.62rem] font-black uppercase tracking-[0.14em] text-tactical-ash">Ordem</span>
              <select
                className="h-10 rounded-xl border border-tactical-ink/10 bg-white px-3 text-xs font-black uppercase tracking-[0.1em] text-tactical-ink outline-none transition focus:border-tactical-pitch"
                value={memberSortField}
                onChange={(event) => setMemberSortField(event.target.value)}
              >
                {MEMBER_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="h-10 rounded-xl border border-tactical-ink/10 bg-white px-3 text-xs font-black uppercase tracking-[0.12em] text-tactical-ink transition hover:border-tactical-pitch/35 hover:bg-tactical-pitch/10"
              onClick={() => setMemberSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
            >
              {memberSortDirection === 'asc' ? 'A-Z' : 'Z-A'}
            </button>
            <span className="rounded-full bg-tactical-pitch/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-tactical-pitch">
              {hasMemberFilters ? `${sortedMembers.length}/${members.length}` : members.length} membros
            </span>
          </div>
        </div>

        <div className="px-5 py-5">
          {sortedMembers.length ? (
            <div className="overflow-x-auto rounded-xl border border-tactical-line/40 bg-white">
              <table className="w-full min-w-[1160px] border-collapse text-left">
                <thead className="bg-tactical-bone/80">
                  <tr>
                    <th className={MEMBER_TABLE_LABEL_CLASS}>Nome</th>
                    <th className={MEMBER_TABLE_LABEL_CLASS}>Sobrenome</th>
                    <th className={MEMBER_TABLE_LABEL_CLASS}>Apelido</th>
                    <th className={MEMBER_TABLE_LABEL_CLASS}>Camisa</th>
                    <th className={MEMBER_TABLE_LABEL_CLASS}>Setor</th>
                    <th className={MEMBER_TABLE_LABEL_CLASS}>Posicao</th>
                    <th className={MEMBER_TABLE_LABEL_CLASS}>Funcao</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMembers.map((member) => {
                    const memberRole = normalizeRole(member.role);
                    const isOnlyAdmin = memberRole === 'admin' && adminCount <= 1;
                    const isAthlete = memberRole === 'atleta';
                    const isChanged = Boolean(memberBaselines[member.id] && memberSignature(member) !== memberBaselines[member.id]);
                    const positionOptions = positionsForSector(member.sector);
                    const inactiveAthleteCell = (
                      <span className="block h-10 rounded-lg border border-transparent px-3 py-2 text-sm font-bold text-tactical-ash">-</span>
                    );

                    return (
                      <tr key={member.id} className={cn('transition hover:bg-tactical-bone/45', isChanged ? 'bg-tactical-pitch/5' : 'bg-white')}>
                        <td className={MEMBER_TABLE_CELL_CLASS}>
                          <input
                            className={MEMBER_TABLE_INPUT_CLASS}
                            value={member.firstName}
                            onChange={(event) => updateMemberField(member.id, 'firstName', event.target.value)}
                            disabled={savingMembers}
                            maxLength={80}
                          />
                        </td>
                        <td className={MEMBER_TABLE_CELL_CLASS}>
                          <input
                            className={MEMBER_TABLE_INPUT_CLASS}
                            value={member.lastName}
                            onChange={(event) => updateMemberField(member.id, 'lastName', event.target.value)}
                            disabled={savingMembers}
                            maxLength={120}
                          />
                        </td>
                        <td className={MEMBER_TABLE_CELL_CLASS}>
                          {isAthlete ? (
                            <input
                              className={MEMBER_TABLE_INPUT_CLASS}
                              value={member.nickname}
                              onChange={(event) => updateMemberField(member.id, 'nickname', event.target.value)}
                              disabled={savingMembers}
                              maxLength={80}
                            />
                          ) : (
                            inactiveAthleteCell
                          )}
                        </td>
                        <td className={cn(MEMBER_TABLE_CELL_CLASS, 'w-24')}>
                          {isAthlete ? (
                            <input
                              className={MEMBER_TABLE_INPUT_CLASS}
                              value={member.jerseyNumber}
                              onChange={(event) => updateMemberField(member.id, 'jerseyNumber', event.target.value)}
                              disabled={savingMembers}
                              maxLength={12}
                            />
                          ) : (
                            inactiveAthleteCell
                          )}
                        </td>
                        <td className={MEMBER_TABLE_CELL_CLASS}>
                          {isAthlete ? (
                            <select
                              className={MEMBER_TABLE_INPUT_CLASS}
                              value={member.sector}
                              onChange={(event) => updateMemberSector(member.id, event.target.value)}
                              disabled={savingMembers}
                            >
                              {SECTOR_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            inactiveAthleteCell
                          )}
                        </td>
                        <td className={MEMBER_TABLE_CELL_CLASS}>
                          {isAthlete ? (
                            <select
                              className={MEMBER_TABLE_INPUT_CLASS}
                              value={member.position}
                              onChange={(event) => updateMemberField(member.id, 'position', event.target.value)}
                              disabled={savingMembers}
                            >
                              <option value="">Selecionar</option>
                              {positionOptions.map((position) => (
                                <option key={position} value={position}>
                                  {position}
                                </option>
                              ))}
                            </select>
                          ) : (
                            inactiveAthleteCell
                          )}
                        </td>
                        <td className={MEMBER_TABLE_CELL_CLASS}>
                          <select
                            className={MEMBER_TABLE_INPUT_CLASS}
                            value={member.role}
                            onChange={(event) => updateMemberRole(member.id, event.target.value)}
                            disabled={savingMembers}
                          >
                            {ROLE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value} disabled={isOnlyAdmin && option.value !== 'admin'}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-tactical-ink/15 px-4 py-10 text-center">
              <strong className="text-sm font-black uppercase tracking-[0.16em] text-tactical-ink">
                {members.length ? 'Nenhum membro encontrado' : 'Nenhum membro vinculado'}
              </strong>
            </div>
          )}
        </div>

        {hasMemberChanges ? (
          <div className="flex flex-col gap-3 border-t border-tactical-ink/10 bg-tactical-bone/55 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs font-black uppercase tracking-[0.14em] text-tactical-ash">
              {changedMembers.length} alteracao{changedMembers.length > 1 ? 'es' : ''} pendente{changedMembers.length > 1 ? 's' : ''}
            </span>
            <button type="button" className="tactical-button min-h-11 px-5" disabled={savingMembers} onClick={saveChangedMembers}>
              {savingMembers ? 'Salvando...' : 'Salvar alteracoes'}
            </button>
          </div>
        ) : null}
      </section>
    </section>
  );
}
