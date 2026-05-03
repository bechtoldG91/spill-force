import { useEffect, useState } from 'react';
import { Icon } from '../components/Icons';
import { authFetch } from '../lib/auth';
import { cn } from '../lib/utils';

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

function roleLabel(role) {
  return ROLE_LABELS[role] || role || 'Membro';
}

function canManageRole(role, authUser) {
  return Boolean(authUser?.globalAdmin || role === 'admin' || role === 'treinador');
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
  return {
    ...member,
    firstName: member.firstName || member.name?.split(' ')[0] || '',
    lastName: member.lastName || member.name?.split(' ').slice(1).join(' ') || '',
    nickname: member.nickname || '',
    jerseyNumber: member.jerseyNumber || '',
    position: member.position || '',
    role: member.role || 'atleta'
  };
}

export function ClubManagePage({ authUser, showToast }) {
  const [team, setTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingMemberId, setSavingMemberId] = useState('');

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
          role
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
          if (!ignore) {
            setTeam(result.team);
            setMembers(result.members);
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
            }
            return;
          }
          const result = await fetchTeamWithMembers(firstTeam.id, 'admin');
          if (!ignore) {
            setTeam(result.team);
            setMembers(result.members);
          }
        }
      } catch (error) {
        if (!ignore) {
          showToast(error.message);
          setTeam(null);
          setMembers([]);
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

  async function saveMember(member) {
    if (!team?.id || !canManage) {
      return;
    }

    setSavingMemberId(member.id);
    try {
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
          position: member.position,
          role: member.role
        })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Nao foi possivel salvar o membro.');
      }

      setMembers((current) =>
        current.map((item) => (item.id === member.id ? initialMember(payload.member) : item))
      );
      showToast('Membro atualizado.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setSavingMemberId('');
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
        </div>

        <div className="relative px-5 pb-5 sm:px-7 sm:pb-7">
          <div className="relative z-10 -mt-20 flex flex-col gap-4 sm:-mt-24 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end">
              <TeamLogo team={team} className="h-32 w-32 border-4 border-white sm:h-40 sm:w-40" roundedClassName="rounded-full" />
              <div className="min-w-0 pb-1">
                <span className="block text-[0.68rem] font-black uppercase tracking-[0.24em] text-tactical-ash">Club manage</span>
                <h1 className="mt-1 truncate text-3xl font-black uppercase tracking-[0.08em] text-tactical-ink sm:text-4xl">
                  {team.name}
                </h1>
                <span className="mt-1 block truncate text-sm font-semibold text-tactical-ash">
                  {team.city || 'Cidade nao informada'}
                </span>
              </div>
            </div>
            <div className="w-fit rounded-full bg-tactical-pitch/10 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-tactical-pitch">
              {roleLabel(team.role)}
            </div>
          </div>
        </div>
      </article>

      <section className="tactical-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-tactical-ink/10 px-5 py-4">
          <div>
            <span className="tactical-label mb-0">Membros</span>
          </div>
          <span className="rounded-full bg-tactical-pitch/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-tactical-pitch">
            {members.length} membros
          </span>
        </div>

        <div className="grid gap-3 px-5 py-5">
          {members.map((member) => (
            <article
              key={member.id}
              className="grid gap-3 rounded-xl border border-tactical-line/35 bg-tactical-bone/35 p-3 xl:grid-cols-[minmax(120px,1fr)_minmax(120px,1fr)_minmax(110px,0.8fr)_88px_minmax(120px,0.9fr)_150px_auto] xl:items-end"
            >
              <label className="block">
                <span className="tactical-label">Nome</span>
                <input
                  className="tactical-input"
                  value={member.firstName}
                  onChange={(event) => updateMemberField(member.id, 'firstName', event.target.value)}
                  maxLength={80}
                />
              </label>
              <label className="block">
                <span className="tactical-label">Sobrenome</span>
                <input
                  className="tactical-input"
                  value={member.lastName}
                  onChange={(event) => updateMemberField(member.id, 'lastName', event.target.value)}
                  maxLength={120}
                />
              </label>
              <label className="block">
                <span className="tactical-label">Apelido</span>
                <input
                  className="tactical-input"
                  value={member.nickname}
                  onChange={(event) => updateMemberField(member.id, 'nickname', event.target.value)}
                  maxLength={80}
                />
              </label>
              <label className="block">
                <span className="tactical-label">Camisa</span>
                <input
                  className="tactical-input"
                  value={member.jerseyNumber}
                  onChange={(event) => updateMemberField(member.id, 'jerseyNumber', event.target.value)}
                  maxLength={12}
                />
              </label>
              <label className="block">
                <span className="tactical-label">Posicao</span>
                <input
                  className="tactical-input"
                  value={member.position}
                  onChange={(event) => updateMemberField(member.id, 'position', event.target.value)}
                  maxLength={80}
                />
              </label>
              <label className="block">
                <span className="tactical-label">Funcao</span>
                <select
                  className="tactical-input"
                  value={member.role}
                  onChange={(event) => updateMemberField(member.id, 'role', event.target.value)}
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="tactical-button h-11 px-3 xl:self-end"
                disabled={savingMemberId === member.id}
                onClick={() => saveMember(member)}
              >
                {savingMemberId === member.id ? 'Salvando...' : 'Salvar'}
              </button>
            </article>
          ))}

          {!members.length ? (
            <div className="rounded-xl border border-dashed border-tactical-ink/15 px-4 py-10 text-center">
              <strong className="text-sm font-black uppercase tracking-[0.16em] text-tactical-ink">Nenhum membro vinculado</strong>
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}
