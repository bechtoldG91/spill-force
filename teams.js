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
  isGlobalAdmin,
  requireGlobalAdmin
} = require('./auth');

const TEAM_READ_ROLES = ['admin', 'treinador', 'atleta'];
const TEAM_ADMIN_ROLES = ['admin'];
const TEAM_EVENT_ROLES = ['admin', 'treinador'];
const TEAM_MANAGE_ROLES = ['admin', 'treinador'];

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

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    firstName,
    lastName,
    nickname: safeText(membership.nickname, 80),
    jerseyNumber: safeText(membership.jerseyNumber, 12),
    position: safeText(membership.position, 80),
    initials: user.initials,
    role
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
    return {
      ...membership,
      role: fields.role || normalizeTeamRole(membership.role) || 'atleta',
      nickname: safeText(fields.nickname, 80),
      jerseyNumber: safeText(fields.jerseyNumber, 12),
      position: safeText(fields.position, 80)
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
  const globalAdmin = await requireGlobalAdmin(req, res);
  if (!globalAdmin) {
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
  const ownerIds = uniqueOwnerIds(payload.ownerIds);
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
      ownerIds
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

    const updatedUser = await repository.updateUser(userId, (user) =>
      updateTeamMembership(user, teamId, {
        firstName,
        lastName: payload.lastName,
        nickname: payload.nickname,
        jerseyNumber: payload.jerseyNumber,
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

  jsonResponse(res, 200, { member: result.member });
}

module.exports = {
  handleListTeams,
  handleCreateTeam,
  handleGetTeam,
  handleUpdateTeam,
  handleListTeamMembers,
  handleUpdateTeamMember
};
