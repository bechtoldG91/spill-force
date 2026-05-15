const { randomUUID } = require('node:crypto');
const {
  storageService,
  jsonResponse,
  safeText,
  readJsonBody
} = require('./storage');
const {
  authorizeRoles,
  getRequestUser,
  normalizeTeamRole,
  normalizeTeamMemberships,
  isGlobalAdmin
} = require('./auth');

const TEAM_READ_ROLES = ['admin', 'treinador', 'atleta'];
const TEAM_ADMIN_ROLES = ['admin'];
const TEAM_EVENT_ROLES = ['admin', 'treinador'];
const TEAM_MANAGE_ROLES = ['admin', 'treinador'];
const TEAM_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const TEAM_POSITION_GROUPS = {
  ataque: ['QB', 'RB', 'WR', 'TE', 'OL'],
  defesa: ['DL', 'LB', 'DB'],
  'special-teams': ['K/P']
};
const TEAM_ROLE_LABELS = {
  admin: 'admin',
  treinador: 'treinador',
  atleta: 'atleta'
};

function roleLabel(role) {
  return TEAM_ROLE_LABELS[role] || role || 'membro';
}

function normalizeTeamSector(value, fallbackPosition = '') {
  const normalized = safeText(value, 40).toLowerCase().replace(/[\s_]+/g, '-');
  if (TEAM_POSITION_GROUPS[normalized]) {
    return normalized;
  }

  const position = safeText(fallbackPosition, 20).toUpperCase();
  return Object.entries(TEAM_POSITION_GROUPS).find(([, positions]) => positions.includes(position))?.[0] || '';
}

function normalizeTeamPosition(value, sector = '') {
  const position = safeText(value, 20).toUpperCase();
  const positions = TEAM_POSITION_GROUPS[sector] || [];
  return positions.includes(position) ? position : '';
}

function teamSummary(team) {
  return {
    id: team.id,
    name: team.name,
    city: team.city || '',
    logoDataUrl: team.logoDataUrl || '',
    coverDataUrl: team.coverDataUrl || '',
    upcomingEvents: normalizeTeamEvents(team.upcomingEvents),
    socialLinks: team.socialLinks || {},
    ownerIds: Array.isArray(team.ownerIds) ? team.ownerIds : []
  };
}

function requestUserSummary(user) {
  const nameParts = splitNameParts(user?.name);
  const firstName = safeText(user?.firstName, 80) || nameParts.firstName;
  const lastName = safeText(user?.lastName, 120) || nameParts.lastName;
  const name = safeText(user?.name, 120) || safeText(`${firstName} ${lastName}`.trim(), 120) || safeText(user?.email, 160);

  return {
    id: safeText(user?.id, 100),
    email: safeText(user?.email, 160).toLowerCase(),
    name,
    firstName,
    lastName,
    initials: safeText(user?.initials, 4) || userInitials(name)
  };
}

function roleChangeRequestSummary(request, user, currentRole) {
  return {
    id: safeText(request?.id, 80),
    requestedAt: safeText(request?.requestedAt, 40),
    status: 'pending',
    requestedRole: normalizeTeamRole(request?.requestedRole),
    currentRole,
    user: requestUserSummary(user)
  };
}

function pendingRequests(requests) {
  return (Array.isArray(requests) ? requests : []).filter((request) => request?.status === 'pending' && safeText(request.userId, 100));
}

function pendingInvites(invites) {
  const now = Date.now();
  return (Array.isArray(invites) ? invites : []).filter((invite) => {
    if (invite?.status !== 'pending' || !safeText(invite.email, 160) || !safeText(invite.code, 120)) {
      return false;
    }

    const expiresAt = Date.parse(invite.expiresAt || '');
    return !Number.isFinite(expiresAt) || expiresAt >= now;
  });
}

function inviteSummary(invite) {
  return {
    id: safeText(invite?.id, 80),
    code: safeText(invite?.code, 120),
    email: safeText(invite?.email, 160).toLowerCase(),
    role: normalizeTeamRole(invite?.role),
    invitedAt: safeText(invite?.invitedAt, 40),
    expiresAt: safeText(invite?.expiresAt, 40),
    status: 'pending',
    registerPath: `/cadastro?convite=${encodeURIComponent(safeText(invite?.code, 120))}`
  };
}

function canApproveTeamRoleChange(approverRole, requestedRole) {
  if (approverRole === 'global-admin' || approverRole === 'admin') {
    return true;
  }

  return approverRole === 'treinador' && requestedRole === 'treinador';
}

function canInviteTeamRole(inviterRole, targetRole) {
  if (inviterRole === 'global-admin' || inviterRole === 'admin') {
    return true;
  }

  return inviterRole === 'treinador' && targetRole !== 'admin';
}

function notifyTeamInvite(team, invite, inviter) {
  if (!invite?.email) {
    return;
  }

  console.info('[email] Convite para clube', {
    to: invite.email,
    subject: `Convite para ${team.name}`,
    text: `${inviter?.name || inviter?.email || 'Um membro da comissao'} convidou voce para ${team.name} como ${roleLabel(invite.role)}. Use o codigo ${invite.code} para criar sua conta.`
  });
}

function splitNameParts(name) {
  const parts = safeText(name, 120).split(' ').filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ')
  };
}

function joinNameParts(firstName, lastName) {
  return safeText(`${firstName} ${lastName}`.trim(), 120);
}

function userInitials(name) {
  return (
    safeText(name, 120)
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('')
      .slice(0, 3) || 'U'
  );
}

function memberSummary(user, role, membership = {}) {
  const nameParts = splitNameParts(user.name);
  const firstName = safeText(user.firstName, 80) || nameParts.firstName;
  const lastName = safeText(user.lastName, 120) || nameParts.lastName;
  const memberRole = normalizeTeamRole(role) || 'atleta';
  const isAthlete = memberRole === 'atleta';
  const sector = isAthlete ? normalizeTeamSector(membership.sector, membership.position) : '';

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    firstName,
    lastName,
    nickname: isAthlete ? safeText(membership.nickname, 80) : '',
    jerseyNumber: isAthlete ? safeText(membership.jerseyNumber, 12) : '',
    sector,
    position: isAthlete ? normalizeTeamPosition(membership.position, sector) : '',
    initials: user.initials,
    role: memberRole
  };
}

function uniqueOwnerIds(ownerIds) {
  return [...new Set((Array.isArray(ownerIds) ? ownerIds : []).map((ownerId) => safeText(ownerId, 100)).filter(Boolean))].slice(0, 50);
}

function uniqueMembers(rawMembers, ownerIds) {
  const membersByUserId = new Map();

  for (const member of Array.isArray(rawMembers) ? rawMembers : []) {
    const userId = safeText(member?.userId || member?.id, 100);
    const role = normalizeTeamRole(member?.role);
    if (!userId || !role) {
      continue;
    }
    membersByUserId.set(userId, { userId, role });
  }

  for (const ownerId of ownerIds) {
    membersByUserId.set(ownerId, { userId: ownerId, role: 'admin' });
  }

  return [...membersByUserId.values()].slice(0, 100);
}

function addTeamMembership(user, teamId, role) {
  const memberships = normalizeTeamMemberships(user.teamMemberships).filter((membership) => membership.teamId !== teamId);
  memberships.push({ teamId, role });
  return {
    ...user,
    teamMemberships: memberships,
    updatedAt: new Date().toISOString()
  };
}

function updateTeamMembership(user, teamId, fields) {
  const memberships = Array.isArray(user.teamMemberships) ? user.teamMemberships : [];
  let found = false;
  const nextMemberships = memberships.map((membership) => {
    if (membership?.teamId !== teamId) {
      return membership;
    }

    found = true;
    const sector = normalizeTeamSector(fields.sector, fields.position);
    const role = fields.role || normalizeTeamRole(membership.role) || 'atleta';
    const isAthlete = role === 'atleta';
    return {
      ...membership,
      role,
      nickname: isAthlete ? safeText(fields.nickname, 80) : '',
      jerseyNumber: isAthlete ? safeText(fields.jerseyNumber, 12) : '',
      sector: isAthlete ? sector : '',
      position: isAthlete ? normalizeTeamPosition(fields.position, sector) : ''
    };
  });

  if (!found) {
    return null;
  }

  const firstName = safeText(fields.firstName, 80);
  const lastName = safeText(fields.lastName, 120);
  const name = joinNameParts(firstName, lastName) || user.name;

  return {
    ...user,
    firstName: firstName || user.firstName,
    lastName,
    name,
    initials: userInitials(name),
    teamMemberships: nextMemberships,
    updatedAt: new Date().toISOString()
  };
}

function removeTeamMembership(user, teamId) {
  const memberships = Array.isArray(user.teamMemberships) ? user.teamMemberships : [];
  const nextMemberships = memberships.filter((membership) => membership?.teamId !== teamId);

  if (nextMemberships.length === memberships.length) {
    return user;
  }

  return {
    ...user,
    teamMemberships: nextMemberships,
    updatedAt: new Date().toISOString()
  };
}

function normalizeLogoDataUrl(value) {
  const raw = safeText(value, 900000);
  if (!raw) {
    return '';
  }

  const validHeader = /^data:image\/(png|jpe?g|webp|svg\+xml);base64,/i.test(raw);
  return validHeader ? raw : '';
}

function normalizeCoverDataUrl(value) {
  const raw = safeText(value, 3000000);
  if (!raw) {
    return '';
  }

  const validHeader = /^data:image\/(png|jpe?g|webp);base64,/i.test(raw);
  return validHeader ? raw : '';
}

function normalizeTeamEvents(events) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event && typeof event === 'object')
    .map((event) => ({
      id: safeText(event.id, 80) || randomUUID(),
      title: safeText(event.title, 120),
      startsAt: safeText(event.startsAt, 40),
      location: safeText(event.location, 120)
    }))
    .filter((event) => event.title)
    .slice(0, 20);
}

function normalizeSocialLinks(socialLinks = {}) {
  return {
    instagram: safeText(socialLinks.instagram, 300),
    website: safeText(socialLinks.website, 300),
    facebook: safeText(socialLinks.facebook, 300),
    x: safeText(socialLinks.x, 300)
  };
}

async function handleListTeams(req, res) {
  const user = await getRequestUser(req);
  if (!user) {
    jsonResponse(res, 401, { error: 'Autenticacao necessaria.' });
    return;
  }

  const teams = await storageService.transaction(async (repository) => {
    const allTeams = await repository.listTeams();
    if (isGlobalAdmin(user)) {
      return allTeams;
    }

    const teamIds = new Set((user.teamMemberships || []).map((membership) => membership.teamId));
    return allTeams.filter((team) => teamIds.has(team.id));
  });

  jsonResponse(res, 200, { teams: teams.map(teamSummary) });
}

async function handleCreateTeam(req, res) {
  const creator = await getRequestUser(req);
  if (!creator) {
    jsonResponse(res, 401, { error: 'Autenticacao necessaria.' });
    return;
  }

  if (!isGlobalAdmin(creator)) {
    jsonResponse(res, 403, { error: 'Apenas admin global pode criar clubes.' });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Time maior que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const name = safeText(payload.name, 120);
  const city = safeText(payload.city, 120);
  const logoDataUrl = normalizeLogoDataUrl(payload.logoDataUrl);
  const coverDataUrl = normalizeCoverDataUrl(payload.coverDataUrl);
  const upcomingEvents = normalizeTeamEvents(payload.upcomingEvents);
  const socialLinks = normalizeSocialLinks(payload.socialLinks);
  const ownerIds = isGlobalAdmin(creator) && Array.isArray(payload.ownerIds) && payload.ownerIds.length ? uniqueOwnerIds(payload.ownerIds) : [creator.id];
  const members = uniqueMembers(payload.members, ownerIds);
  if (!name) {
    jsonResponse(res, 400, { error: 'Informe o nome do time.' });
    return;
  }

  if (!ownerIds.length) {
    jsonResponse(res, 400, { error: 'Informe pelo menos um administrador do time.' });
    return;
  }

  const result = await storageService.transaction(async (repository) => {
    const users = await repository.listUsers();
    const knownUserIds = new Set(users.map((user) => user.id));
    const missingOwnerIds = ownerIds.filter((ownerId) => !knownUserIds.has(ownerId));
    const missingMemberIds = members.map((member) => member.userId).filter((userId) => !knownUserIds.has(userId));

    if (missingOwnerIds.length || missingMemberIds.length) {
      return { missingOwnerIds, missingMemberIds };
    }

    const now = new Date().toISOString();
    const team = {
      id: randomUUID(),
      name,
      city,
      logoDataUrl,
      coverDataUrl,
      upcomingEvents,
      socialLinks,
      ownerIds,
      invites: [],
      roleChangeRequests: []
    };

    await repository.createTeam(team);

    for (const member of members) {
      await repository.updateUser(member.userId, (user) => addTeamMembership(user, team.id, member.role));
    }

    return {
      team: {
        ...team,
        createdAt: now,
        updatedAt: now
      }
    };
  });

  if (result.missingOwnerIds || result.missingMemberIds) {
    jsonResponse(res, 400, {
      error: 'Um ou mais usuarios do time nao existem.',
      ownerIds: result.missingOwnerIds || [],
      memberIds: result.missingMemberIds || []
    });
    return;
  }

  jsonResponse(res, 201, { team: teamSummary(result.team) });
}

async function handleGetTeam(req, res, id) {
  const teamId = safeText(decodeURIComponent(id), 80);
  const access = await authorizeRoles(req, res, teamId, TEAM_READ_ROLES);
  if (!access) {
    return;
  }

  jsonResponse(res, 200, { team: teamSummary(access.team) });
}

async function handleUpdateTeam(req, res, id) {
  const teamId = safeText(decodeURIComponent(id), 80);
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Dados do time maiores que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const hasCoverDataUrl = Object.prototype.hasOwnProperty.call(payload, 'coverDataUrl');
  const hasLogoDataUrl = Object.prototype.hasOwnProperty.call(payload, 'logoDataUrl');
  const hasUpcomingEvents = Object.prototype.hasOwnProperty.call(payload, 'upcomingEvents');

  if (!hasCoverDataUrl && !hasLogoDataUrl && !hasUpcomingEvents) {
    jsonResponse(res, 400, { error: 'Informe os dados do time.' });
    return;
  }

  const requiredRoles = hasCoverDataUrl || hasLogoDataUrl ? TEAM_ADMIN_ROLES : TEAM_EVENT_ROLES;
  const access = await authorizeRoles(req, res, teamId, requiredRoles);
  if (!access) {
    return;
  }

  const coverDataUrl = hasCoverDataUrl ? normalizeCoverDataUrl(payload.coverDataUrl) : undefined;
  if (hasCoverDataUrl && payload.coverDataUrl && !coverDataUrl) {
    jsonResponse(res, 400, { error: 'Use uma imagem PNG, JPG ou WebP valida.' });
    return;
  }
  const logoDataUrl = hasLogoDataUrl ? normalizeLogoDataUrl(payload.logoDataUrl) : undefined;
  if (hasLogoDataUrl && payload.logoDataUrl && !logoDataUrl) {
    jsonResponse(res, 400, { error: 'Use uma imagem valida para o logo.' });
    return;
  }
  const upcomingEvents = hasUpcomingEvents ? normalizeTeamEvents(payload.upcomingEvents) : undefined;

  const team = await storageService.transaction((repository) =>
    repository.updateTeam(teamId, (currentTeam) => {
      const nextTeam = {
        ...currentTeam,
        updatedAt: new Date().toISOString()
      };

      if (hasCoverDataUrl) {
        nextTeam.coverDataUrl = coverDataUrl;
      }

      if (hasLogoDataUrl) {
        nextTeam.logoDataUrl = logoDataUrl;
      }

      if (hasUpcomingEvents) {
        nextTeam.upcomingEvents = upcomingEvents;
      }

      return nextTeam;
    })
  );

  if (!team) {
    jsonResponse(res, 404, { error: 'Time nao encontrado.' });
    return;
  }

  jsonResponse(res, 200, { team: teamSummary(team) });
}

async function handleDeleteTeam(req, res, id) {
  const teamId = safeText(decodeURIComponent(id), 80);
  const access = await authorizeRoles(req, res, teamId, TEAM_ADMIN_ROLES);
  if (!access) {
    return;
  }

  const result = await storageService.transaction(async (repository) => {
    const teams = await repository.listTeams();
    const team = teams.find((item) => item.id === teamId);
    if (!team) {
      return { found: false };
    }

    const scope = { teamId };
    const videos = await repository.listVideos(scope);
    const playlists = await repository.listPlaylists(scope);
    const videoIds = videos.map((video) => video.id);
    const storageNames = videos.map((video) => video.storageName).filter(Boolean);

    await repository.saveVideos([], scope);
    await repository.savePlaylists([], scope);
    await repository.deleteAnnotationsForVideos(videoIds);
    await repository.saveTeams(teams.filter((item) => item.id !== teamId));

    const users = await repository.listUsers();
    for (const user of users) {
      if ((Array.isArray(user.teamMemberships) ? user.teamMemberships : []).some((membership) => membership?.teamId === teamId)) {
        await repository.updateUser(user.id, (currentUser) => removeTeamMembership(currentUser, teamId));
      }
    }

    return {
      found: true,
      deletedVideos: videos.length,
      deletedPlaylists: playlists.length,
      storageNames
    };
  });

  if (!result.found) {
    jsonResponse(res, 404, { error: 'Time nao encontrado.' });
    return;
  }

  await Promise.all(result.storageNames.map((storageName) => storageService.removeVideoFile(storageName)));

  jsonResponse(res, 200, {
    ok: true,
    deletedVideos: result.deletedVideos,
    deletedPlaylists: result.deletedPlaylists
  });
}

async function handleLeaveTeam(req, res, id) {
  const user = await getRequestUser(req);
  if (!user) {
    jsonResponse(res, 401, { error: 'Autenticacao necessaria.' });
    return;
  }

  const teamId = safeText(decodeURIComponent(id), 80);
  const result = await storageService.transaction(async (repository) => {
    const team = await repository.findTeamById(teamId);
    if (!team) {
      return { missing: true };
    }

    const users = await repository.listUsers();
    const targetUser = users.find((item) => item.id === user.id);
    const membership = (Array.isArray(targetUser?.teamMemberships) ? targetUser.teamMemberships : []).find(
      (item) => item?.teamId === teamId
    );

    if (!targetUser || !membership) {
      return { notMember: true };
    }

    const role = normalizeTeamRole(membership.role);
    const adminCount = users.reduce((count, item) => {
      const isTeamAdmin = normalizeTeamMemberships(item.teamMemberships).some(
        (teamMembership) => teamMembership.teamId === teamId && teamMembership.role === 'admin'
      );
      return isTeamAdmin ? count + 1 : count;
    }, 0);

    if (role === 'admin' && adminCount <= 1) {
      return { lastAdmin: true };
    }

    await repository.updateUser(user.id, (currentUser) => removeTeamMembership(currentUser, teamId));
    await repository.updateTeam(teamId, (currentTeam) => ({
      ...currentTeam,
      ownerIds: (Array.isArray(currentTeam.ownerIds) ? currentTeam.ownerIds : []).filter((ownerId) => ownerId !== user.id),
      roleChangeRequests: pendingRequests(currentTeam.roleChangeRequests).filter((request) => request.userId !== user.id),
      updatedAt: new Date().toISOString()
    }));

    return { ok: true };
  });

  if (result.missing) {
    jsonResponse(res, 404, { error: 'Clube nao encontrado.' });
    return;
  }

  if (result.notMember) {
    jsonResponse(res, 404, { error: 'Voce nao faz parte deste clube.' });
    return;
  }

  if (result.lastAdmin) {
    jsonResponse(res, 400, { error: 'Voce e o unico admin do clube. Promova outro admin antes de sair.' });
    return;
  }

  jsonResponse(res, 200, { ok: true });
}

async function handleListTeamInvites(req, res, id) {
  const teamId = safeText(decodeURIComponent(id), 80);
  const access = await authorizeRoles(req, res, teamId, TEAM_MANAGE_ROLES);
  if (!access) {
    return;
  }

  const invites = pendingInvites(access.team.invites)
    .filter((invite) => canInviteTeamRole(access.role, normalizeTeamRole(invite.role)))
    .map(inviteSummary);

  jsonResponse(res, 200, { invites });
}

async function handleCreateTeamInvite(req, res, id) {
  const teamId = safeText(decodeURIComponent(id), 80);
  const access = await authorizeRoles(req, res, teamId, TEAM_MANAGE_ROLES);
  if (!access) {
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Convite maior que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const email = safeText(payload.email, 160).toLowerCase();
  const role = normalizeTeamRole(payload.role) || 'atleta';
  if (!email || !email.includes('@')) {
    jsonResponse(res, 400, { error: 'Informe um email valido para o convite.' });
    return;
  }

  if (!canInviteTeamRole(access.role, role)) {
    jsonResponse(res, 403, { error: 'Permissao insuficiente para convidar esta funcao.' });
    return;
  }

  const result = await storageService.transaction(async (repository) => {
    const existingUser = await repository.findUserByEmail(email);
    if (existingUser) {
      const existingMembership = normalizeTeamMemberships(existingUser.teamMemberships).find((membership) => membership.teamId === teamId);
      if (existingMembership) {
        return { alreadyMember: true };
      }
    }

    const invite = {
      id: randomUUID(),
      code: randomUUID(),
      email,
      role,
      invitedBy: access.user.id,
      invitedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + TEAM_INVITE_TTL_MS).toISOString(),
      status: 'pending'
    };

    const updatedTeam = await repository.updateTeam(teamId, (team) => ({
      ...team,
      invites: [...pendingInvites(team.invites).filter((item) => safeText(item.email, 160).toLowerCase() !== email), invite],
      updatedAt: new Date().toISOString()
    }));

    return { team: updatedTeam, invite };
  });

  if (result.alreadyMember) {
    jsonResponse(res, 409, { error: 'Este usuario ja faz parte do clube.' });
    return;
  }

  if (!result.team) {
    jsonResponse(res, 404, { error: 'Clube nao encontrado.' });
    return;
  }

  notifyTeamInvite(result.team, result.invite, access.user);
  jsonResponse(res, 201, { invite: inviteSummary(result.invite) });
}

async function handleDeleteTeamInvite(req, res, id, inviteId) {
  const teamId = safeText(decodeURIComponent(id), 80);
  const access = await authorizeRoles(req, res, teamId, TEAM_MANAGE_ROLES);
  if (!access) {
    return;
  }

  const safeInviteId = safeText(decodeURIComponent(inviteId), 80);
  const result = await storageService.transaction(async (repository) => {
    const team = await repository.findTeamById(teamId);
    if (!team) {
      return { missing: true };
    }

    const invite = pendingInvites(team.invites).find((item) => item.id === safeInviteId);
    if (!invite) {
      return { missingInvite: true };
    }

    if (!canInviteTeamRole(access.role, normalizeTeamRole(invite.role))) {
      return { forbidden: true };
    }

    await repository.updateTeam(teamId, (currentTeam) => ({
      ...currentTeam,
      invites: pendingInvites(currentTeam.invites).filter((item) => item.id !== safeInviteId),
      updatedAt: new Date().toISOString()
    }));

    return { ok: true };
  });

  if (result.missing) {
    jsonResponse(res, 404, { error: 'Clube nao encontrado.' });
    return;
  }

  if (result.missingInvite) {
    jsonResponse(res, 404, { error: 'Convite nao encontrado.' });
    return;
  }

  if (result.forbidden) {
    jsonResponse(res, 403, { error: 'Permissao insuficiente para cancelar este convite.' });
    return;
  }

  jsonResponse(res, 200, { ok: true });
}

async function handleCreateTeamRoleChangeRequest(req, res, id) {
  const teamId = safeText(decodeURIComponent(id), 80);
  const access = await authorizeRoles(req, res, teamId, TEAM_READ_ROLES);
  if (!access) {
    return;
  }

  if (access.role === 'global-admin') {
    jsonResponse(res, 400, { error: 'Admin global nao precisa solicitar mudanca de funcao no clube.' });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Solicitacao maior que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const requestedRole = normalizeTeamRole(payload.role);
  if (!requestedRole || requestedRole === access.role) {
    jsonResponse(res, 400, { error: 'Escolha uma nova funcao valida.' });
    return;
  }

  const result = await storageService.transaction(async (repository) => {
    const request = {
      id: randomUUID(),
      userId: access.user.id,
      requestedRole,
      requestedAt: new Date().toISOString(),
      status: 'pending'
    };

    const updatedTeam = await repository.updateTeam(teamId, (team) => ({
      ...team,
      roleChangeRequests: [
        ...pendingRequests(team.roleChangeRequests).filter((item) => item.userId !== access.user.id),
        request
      ],
      updatedAt: new Date().toISOString()
    }));

    return { team: updatedTeam, request };
  });

  if (!result.team) {
    jsonResponse(res, 404, { error: 'Clube nao encontrado.' });
    return;
  }

  jsonResponse(res, 201, {
    request: {
      id: result.request.id,
      requestedRole: result.request.requestedRole,
      requestedAt: result.request.requestedAt,
      status: 'pending'
    }
  });
}

async function handleListTeamRoleChangeRequests(req, res, id) {
  const teamId = safeText(decodeURIComponent(id), 80);
  const access = await authorizeRoles(req, res, teamId, TEAM_MANAGE_ROLES);
  if (!access) {
    return;
  }

  const requests = await storageService.transaction(async (repository) => {
    const users = await repository.listUsers();
    const usersById = new Map(users.map((user) => [user.id, user]));
    return pendingRequests(access.team.roleChangeRequests)
      .map((request) => {
        const requestedRole = normalizeTeamRole(request.requestedRole);
        if (!requestedRole || !canApproveTeamRoleChange(access.role, requestedRole)) {
          return null;
        }

        const user = usersById.get(request.userId);
        const currentRole = normalizeTeamMemberships(user?.teamMemberships).find((membership) => membership.teamId === teamId)?.role || '';
        return user && currentRole ? roleChangeRequestSummary(request, user, currentRole) : null;
      })
      .filter(Boolean);
  });

  jsonResponse(res, 200, { requests });
}

async function handleApproveTeamRoleChangeRequest(req, res, id, requestId) {
  const teamId = safeText(decodeURIComponent(id), 80);
  const access = await authorizeRoles(req, res, teamId, TEAM_MANAGE_ROLES);
  if (!access) {
    return;
  }

  const safeRequestId = safeText(decodeURIComponent(requestId), 80);
  const result = await storageService.transaction(async (repository) => {
    const team = await repository.findTeamById(teamId);
    if (!team) {
      return { missing: true };
    }

    const requests = pendingRequests(team.roleChangeRequests);
    const request = requests.find((item) => item.id === safeRequestId);
    if (!request) {
      return { missingRequest: true };
    }

    const requestedRole = normalizeTeamRole(request.requestedRole);
    if (!requestedRole || !canApproveTeamRoleChange(access.role, requestedRole)) {
      return { forbidden: true };
    }

    const targetUser = await repository.findUserById(request.userId);
    if (!targetUser) {
      return { missingUser: true };
    }

    const currentMembership = (Array.isArray(targetUser.teamMemberships) ? targetUser.teamMemberships : []).find(
      (membership) => membership?.teamId === teamId
    );
    if (!currentMembership) {
      return { notMember: true };
    }

    const users = await repository.listUsers();
    const adminCount = users.reduce((count, user) => {
      const isTeamAdmin = normalizeTeamMemberships(user.teamMemberships).some(
        (membership) => membership.teamId === teamId && membership.role === 'admin'
      );
      return isTeamAdmin ? count + 1 : count;
    }, 0);

    if (normalizeTeamRole(currentMembership.role) === 'admin' && requestedRole !== 'admin' && adminCount <= 1) {
      return { lastAdmin: true };
    }

    const updatedUser = await repository.updateUser(targetUser.id, (user) =>
      updateTeamMembership(user, teamId, {
        firstName: targetUser.firstName || splitNameParts(targetUser.name).firstName,
        lastName: targetUser.lastName || splitNameParts(targetUser.name).lastName,
        nickname: currentMembership.nickname,
        jerseyNumber: currentMembership.jerseyNumber,
        sector: currentMembership.sector,
        position: currentMembership.position,
        role: requestedRole
      })
    );

    await repository.updateTeam(teamId, (currentTeam) => ({
      ...currentTeam,
      roleChangeRequests: pendingRequests(currentTeam.roleChangeRequests).filter((item) => item.id !== safeRequestId),
      updatedAt: new Date().toISOString()
    }));

    const updatedMembership = normalizeTeamMemberships(updatedUser.teamMemberships).find((membership) => membership.teamId === teamId);
    return { member: memberSummary(updatedUser, updatedMembership.role, updatedMembership) };
  });

  if (result.missing) {
    jsonResponse(res, 404, { error: 'Clube nao encontrado.' });
    return;
  }

  if (result.missingRequest) {
    jsonResponse(res, 404, { error: 'Solicitacao nao encontrada.' });
    return;
  }

  if (result.missingUser || result.notMember) {
    jsonResponse(res, 404, { error: 'Membro nao encontrado.' });
    return;
  }

  if (result.forbidden) {
    jsonResponse(res, 403, { error: 'Permissao insuficiente para aprovar esta mudanca.' });
    return;
  }

  if (result.lastAdmin) {
    jsonResponse(res, 400, { error: 'O clube precisa manter pelo menos um admin.' });
    return;
  }

  jsonResponse(res, 200, { member: result.member });
}

async function handleListTeamMembers(req, res, id) {
  const teamId = safeText(decodeURIComponent(id), 80);
  const access = await authorizeRoles(req, res, teamId, TEAM_READ_ROLES);
  if (!access) {
    return;
  }

  const members = await storageService.transaction(async (repository) => {
    const teamMembers = await repository.listTeamMembers(teamId);
    return teamMembers.map(({ user, role, membership }) => memberSummary(user, role, membership));
  });

  jsonResponse(res, 200, { members });
}

async function handleUpdateTeamMember(req, res, id, memberId) {
  const teamId = safeText(decodeURIComponent(id), 80);
  const access = await authorizeRoles(req, res, teamId, TEAM_MANAGE_ROLES);
  if (!access) {
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Dados do membro maiores que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const userId = safeText(decodeURIComponent(memberId), 100);
  const role = normalizeTeamRole(payload.role);
  if (!role) {
    jsonResponse(res, 400, { error: 'Informe uma funcao valida.' });
    return;
  }

  const firstName = safeText(payload.firstName, 80);
  if (!firstName) {
    jsonResponse(res, 400, { error: 'Informe o nome.' });
    return;
  }

  const result = await storageService.transaction(async (repository) => {
    const users = await repository.listUsers();
    const targetUser = users.find((user) => user.id === userId);
    if (!targetUser) {
      return { missing: true };
    }

    const currentMembership = (Array.isArray(targetUser.teamMemberships) ? targetUser.teamMemberships : []).find(
      (membership) => membership.teamId === teamId
    );
    if (!currentMembership) {
      return { notMember: true };
    }

    const currentRole = normalizeTeamRole(currentMembership.role);
    const canSetAdminRole = access.role === 'global-admin' || access.role === 'admin';
    if ((currentRole === 'admin' || role === 'admin') && !canSetAdminRole) {
      return { forbiddenRole: true };
    }

    const adminCount = users.reduce((count, user) => {
      const isTeamAdmin = (Array.isArray(user.teamMemberships) ? user.teamMemberships : []).some(
        (membership) => membership?.teamId === teamId && normalizeTeamRole(membership.role) === 'admin'
      );
      return isTeamAdmin ? count + 1 : count;
    }, 0);

    if (currentRole === 'admin' && role !== 'admin' && adminCount <= 1) {
      return { lastAdmin: true };
    }

    const updatedUser = await repository.updateUser(userId, (user) =>
      updateTeamMembership(user, teamId, {
        firstName,
        lastName: payload.lastName,
        nickname: payload.nickname,
        jerseyNumber: payload.jerseyNumber,
        sector: payload.sector,
        position: payload.position,
        role
      })
    );
    const updatedMembership = (updatedUser.teamMemberships || []).find((membership) => membership.teamId === teamId);

    return {
      member: memberSummary(updatedUser, updatedMembership.role, updatedMembership)
    };
  });

  if (result.missing) {
    jsonResponse(res, 404, { error: 'Usuario nao encontrado.' });
    return;
  }

  if (result.notMember) {
    jsonResponse(res, 404, { error: 'Membro nao encontrado neste clube.' });
    return;
  }

  if (result.forbiddenRole) {
    jsonResponse(res, 403, { error: 'Apenas admin pode alterar funcoes de admin.' });
    return;
  }

  if (result.lastAdmin) {
    jsonResponse(res, 400, { error: 'O clube precisa manter pelo menos um admin.' });
    return;
  }

  jsonResponse(res, 200, { member: result.member });
}

async function handleUpdateOwnTeamMembership(req, res, id) {
  const teamId = safeText(decodeURIComponent(id), 80);
  const access = await authorizeRoles(req, res, teamId, TEAM_READ_ROLES);
  if (!access) {
    return;
  }

  if (access.role !== 'atleta') {
    jsonResponse(res, 403, { error: 'Apenas atletas podem alterar dados esportivos pela pagina do clube.' });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Dados do atleta maiores que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const result = await storageService.transaction(async (repository) => {
    const targetUser = await repository.findUserById(access.user.id);
    if (!targetUser) {
      return { missing: true };
    }

    const currentMembership = (Array.isArray(targetUser.teamMemberships) ? targetUser.teamMemberships : []).find(
      (membership) => membership.teamId === teamId
    );
    if (!currentMembership) {
      return { notMember: true };
    }

    const currentRole = normalizeTeamRole(currentMembership.role);
    if (currentRole !== 'atleta') {
      return { forbiddenRole: true };
    }

    const nameParts = splitNameParts(targetUser.name);
    const updatedUser = await repository.updateUser(targetUser.id, (user) =>
      updateTeamMembership(user, teamId, {
        firstName: targetUser.firstName || nameParts.firstName,
        lastName: targetUser.lastName || nameParts.lastName,
        nickname: payload.nickname,
        jerseyNumber: payload.jerseyNumber,
        sector: payload.sector,
        position: payload.position,
        role: currentRole
      })
    );
    const updatedMembership = (updatedUser.teamMemberships || []).find((membership) => membership.teamId === teamId);

    return {
      member: memberSummary(updatedUser, updatedMembership.role, updatedMembership)
    };
  });

  if (result.missing) {
    jsonResponse(res, 404, { error: 'Usuario nao encontrado.' });
    return;
  }

  if (result.notMember) {
    jsonResponse(res, 404, { error: 'Membro nao encontrado neste clube.' });
    return;
  }

  if (result.forbiddenRole) {
    jsonResponse(res, 403, { error: 'Apenas atletas podem alterar esses campos.' });
    return;
  }

  jsonResponse(res, 200, { member: result.member });
}

module.exports = {
  handleListTeams,
  handleCreateTeam,
  handleGetTeam,
  handleUpdateTeam,
  handleDeleteTeam,
  handleLeaveTeam,
  handleListTeamInvites,
  handleCreateTeamInvite,
  handleDeleteTeamInvite,
  handleCreateTeamRoleChangeRequest,
  handleListTeamRoleChangeRequests,
  handleApproveTeamRoleChangeRequest,
  handleListTeamMembers,
  handleUpdateTeamMember,
  handleUpdateOwnTeamMembership
};
