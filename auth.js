const { createHmac, randomInt, randomUUID, timingSafeEqual } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { config } = require('./config');
const {
  storageService,
  jsonResponse,
  safeText,
  readJsonBody
} = require('./storage');

const AUTH_COOKIE_NAME = 'sf_token';
const TEAM_ROLES = new Set(['admin', 'treinador', 'atleta']);
const JWT_SECRET = config.jwtSecret;
const JWT_TTL_SECONDS = config.jwtTtlSeconds;
const PASSWORD_HASH_ROUNDS = config.passwordHashRounds;
const MAX_PROFILE_PHOTO_DATA_URL_LENGTH = 1400000;
const PROFILE_PHOTO_DATA_URL_PATTERN = /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i;
const PASSWORD_RESET_CODE_TTL_MS = 15 * 60 * 1000;
const PASSWORD_RESET_CODE_PATTERN = /^\d{6}$/;

function base64UrlEncode(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return input.toString('base64url');
}

function base64UrlJson(value) {
  return base64UrlEncode(JSON.stringify(value));
}

function signJwt(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    iat: now,
    exp: now + JWT_TTL_SECONDS
  };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expected = createHmac('sha256', JWT_SECRET).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    return null;
  }

  if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

function safeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function generatePasswordResetCode() {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

function hashPasswordResetCode(email, code) {
  return createHmac('sha256', JWT_SECRET).update(`${normalizeEmail(email)}:${String(code || '')}`).digest('hex');
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) {
        return cookies;
      }
      const key = part.slice(0, separatorIndex);
      const value = part.slice(separatorIndex + 1);
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function getBearerToken(req) {
  const authorization = String(req.headers.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (match) {
    return match[1].trim();
  }

  return parseCookies(req.headers.cookie)[AUTH_COOKIE_NAME] || '';
}

function publicUser(user) {
  if (!user) {
    return null;
  }

  const name = safeText(user.name, 120) || safeText(user.email, 160);
  const nameParts = splitNameParts(name);
  const firstName = safeText(user.firstName, 80) || nameParts.firstName;
  const lastName = safeText(user.lastName, 120) || nameParts.lastName;
  const initials = safeText(user.initials, 4) || name.slice(0, 2).toUpperCase();
  const email = safeText(user.email, 160).toLowerCase();
  const avatarDataUrl = cleanProfilePhotoDataUrl(user.avatarDataUrl);
  const phone = normalizePhone(user.phone);

  return {
    id: user.id,
    email,
    name,
    firstName,
    lastName,
    phone,
    initials,
    avatarDataUrl,
    globalAdmin: isGlobalAdmin({ email, globalAdmin: user.globalAdmin }),
    teamMemberships: normalizeTeamMemberships(user.teamMemberships)
  };
}

function normalizeEmail(value) {
  return safeText(value, 160).toLowerCase();
}

function normalizeName(value, email) {
  const name = safeText(value, 120);
  if (name) {
    return name;
  }

  return email.split('@')[0] || 'Usuario';
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
  return safeText(name, 120)
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
    .slice(0, 3) || 'U';
}

function normalizePhone(value) {
  return safeText(value, 40)
    .replace(/[^\d+()\-\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanProfilePhotoDataUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > MAX_PROFILE_PHOTO_DATA_URL_LENGTH || !PROFILE_PHOTO_DATA_URL_PATTERN.test(raw)) {
    return '';
  }

  return raw;
}

function parseProfilePhotoDataUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return { avatarDataUrl: '' };
  }

  if (raw.length > MAX_PROFILE_PHOTO_DATA_URL_LENGTH) {
    return { error: 'Use uma imagem menor para a foto do perfil.' };
  }

  if (!PROFILE_PHOTO_DATA_URL_PATTERN.test(raw)) {
    return { error: 'Use uma imagem PNG, JPG ou WebP valida.' };
  }

  return { avatarDataUrl: raw };
}

function normalizeTeamRole(role) {
  const normalized = safeText(role, 40).toLowerCase();
  return TEAM_ROLES.has(normalized) ? normalized : '';
}

function normalizeTeamMemberships(memberships) {
  const seen = new Set();
  return (Array.isArray(memberships) ? memberships : [])
    .map((membership) => ({
      teamId: safeText(membership?.teamId, 80),
      role: normalizeTeamRole(membership?.role)
    }))
    .filter((membership) => {
      if (!membership.teamId || !membership.role || seen.has(membership.teamId)) {
        return false;
      }
      seen.add(membership.teamId);
      return true;
    });
}

function accountCanAccessApp(user) {
  return Boolean(user?.id);
}

function adminUserSummary(user, teamsById = new Map()) {
  const responseUser = publicUser(user);
  return {
    id: responseUser.id,
    email: responseUser.email,
    name: responseUser.name,
    firstName: responseUser.firstName,
    lastName: responseUser.lastName,
    phone: responseUser.phone,
    initials: responseUser.initials,
    globalAdmin: responseUser.globalAdmin,
    teamMemberships: responseUser.teamMemberships.map((membership) => ({
      ...membership,
      name: safeText(teamsById.get(membership.teamId)?.name, 120)
    })),
    createdAt: safeText(user.createdAt, 40),
    updatedAt: safeText(user.updatedAt, 40)
  };
}

function lastAdminTeamIdsForUser(targetUser, users) {
  const adminTeamIds = normalizeTeamMemberships(targetUser.teamMemberships)
    .filter((membership) => membership.role === 'admin')
    .map((membership) => membership.teamId);

  if (!adminTeamIds.length) {
    return [];
  }

  const adminCounts = new Map();
  for (const user of users) {
    for (const membership of normalizeTeamMemberships(user.teamMemberships)) {
      if (membership.role === 'admin') {
        adminCounts.set(membership.teamId, (adminCounts.get(membership.teamId) || 0) + 1);
      }
    }
  }

  return adminTeamIds.filter((teamId) => (adminCounts.get(teamId) || 0) <= 1);
}

async function deleteUserAccountData(repository, userId, { protectLastTeamAdmin = true } = {}) {
  const safeUserId = safeText(userId, 100);
  const users = await repository.listUsers();
  const targetUser = users.find((user) => user.id === safeUserId);
  if (!targetUser) {
    return { missing: true };
  }

  const teams = await repository.listTeams();
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const lastAdminTeamIds = protectLastTeamAdmin ? lastAdminTeamIdsForUser(targetUser, users) : [];
  if (lastAdminTeamIds.length) {
    return {
      lastAdminTeams: lastAdminTeamIds.map((teamId) => teamsById.get(teamId)?.name || teamId)
    };
  }

  const personalScope = { ownerId: targetUser.id };
  const videos = await repository.listVideos(personalScope);
  const playlists = await repository.listPlaylists(personalScope);
  const videoIds = videos.map((video) => video.id).filter(Boolean);
  const storageNames = videos.map((video) => video.storageName).filter(Boolean);

  await repository.saveVideos([], personalScope);
  await repository.savePlaylists([], personalScope);
  await repository.deleteAnnotationsForVideos(videoIds);

  const nextTeams = teams.map((team) => {
    const ownerIds = (Array.isArray(team.ownerIds) ? team.ownerIds : []).filter((ownerId) => ownerId !== targetUser.id);
    const invites = (Array.isArray(team.invites) ? team.invites : []).filter(
      (invite) => normalizeEmail(invite?.email) !== normalizeEmail(targetUser.email) && invite?.invitedBy !== targetUser.id
    );
    const roleChangeRequests = (Array.isArray(team.roleChangeRequests) ? team.roleChangeRequests : []).filter(
      (request) => request?.userId !== targetUser.id
    );
    const changed =
      ownerIds.length !== (Array.isArray(team.ownerIds) ? team.ownerIds : []).length ||
      invites.length !== (Array.isArray(team.invites) ? team.invites : []).length ||
      roleChangeRequests.length !== (Array.isArray(team.roleChangeRequests) ? team.roleChangeRequests : []).length;

    return changed
      ? {
          ...team,
          ownerIds,
          invites,
          roleChangeRequests,
          updatedAt: new Date().toISOString()
        }
      : team;
  });

  await repository.saveTeams(nextTeams);
  const deletedUser = await repository.deleteUser(targetUser.id);

  return {
    user: deletedUser,
    deletedVideos: videos.length,
    deletedPlaylists: playlists.length,
    storageNames
  };
}

function isGlobalAdmin(user) {
  if (user?.globalAdmin === true) {
    return true;
  }

  const email = safeText(user?.email, 160).toLowerCase();
  return Boolean(email && config.globalAdminEmails.includes(email));
}

function findTeamMembership(user, teamId) {
  const safeTeamId = safeText(teamId, 80);
  return normalizeTeamMemberships(user?.teamMemberships).find((membership) => membership.teamId === safeTeamId) || null;
}

function getTeamIdFromRequest(req, requestUrl, payload = {}) {
  const url = requestUrl || new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  return safeText(payload.teamId || url.searchParams.get('teamId'), 80);
}

function accessScope(access) {
  return {
    ownerId: access?.ownerId,
    teamId: access?.teamId || undefined
  };
}

function setAuthCookie(res, token) {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${JWT_TTL_SECONDS}; SameSite=Lax`);
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`);
}

async function getRequestUser(req) {
  const token = getBearerToken(req);
  const payload = verifyJwt(token);

  if (!payload) {
    return null;
  }

  const user = await storageService.findUserById(payload.sub);
  return user ? publicUser(user) : null;
}

async function requireGlobalAdmin(req, res) {
  const user = await getRequestUser(req);
  if (!user) {
    jsonResponse(res, 401, { error: 'Autenticacao necessaria.' });
    return null;
  }

  if (!isGlobalAdmin(user)) {
    jsonResponse(res, 403, { error: 'Permissao de administrador global necessaria.' });
    return null;
  }

  return user;
}

async function authorizeRoles(req, res, teamId, roles) {
  const safeTeamId = safeText(teamId, 80);
  const allowedRoles = new Set((Array.isArray(roles) ? roles : [roles]).map(normalizeTeamRole).filter(Boolean));

  if (!safeTeamId) {
    const user = await getRequestUser(req);
    if (!user) {
      jsonResponse(res, 401, { error: 'Autenticacao necessaria.' });
      return null;
    }

    if (isGlobalAdmin(user)) {
      return {
        user,
        ownerId: user.id,
        teamId: '',
        role: 'global-admin'
      };
    }

    const membership = normalizeTeamMemberships(user.teamMemberships).find(
      (item) => !allowedRoles.size || allowedRoles.has(item.role)
    );

    if (!membership) {
      jsonResponse(res, 403, { error: 'Permissao insuficiente.' });
      return null;
    }

    const team = await storageService.findTeamById(membership.teamId);
    return {
      user,
      ownerId: user.id,
      teamId: membership.teamId,
      team,
      role: membership.role
    };
  }

  const user = await getRequestUser(req);
  if (!user) {
    jsonResponse(res, 401, { error: 'Autenticacao necessaria para acessar este time.' });
    return null;
  }

  const team = await storageService.findTeamById(safeTeamId);
  if (!team) {
    jsonResponse(res, 404, { error: 'Time nao encontrado.' });
    return null;
  }

  if (isGlobalAdmin(user)) {
    return {
      user,
      ownerId: user.id,
      teamId: safeTeamId,
      team,
      role: 'global-admin'
    };
  }

  const membership = findTeamMembership(user, safeTeamId);
  if (!membership || (allowedRoles.size && !allowedRoles.has(membership.role))) {
    jsonResponse(res, 403, { error: 'Permissao insuficiente para este time.' });
    return null;
  }

  return {
    user,
    ownerId: user.id,
    teamId: safeTeamId,
    team,
    role: membership.role
  };
}

async function handleRegister(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Cadastro maior que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const email = normalizeEmail(payload.email);
  const password = String(payload.password || '');
  const name = normalizeName(payload.name, email);
  const inviteCode = safeText(payload.inviteCode || payload.invite || payload.code, 120);
  const nameParts = splitNameParts(name);

  if (!email || !email.includes('@')) {
    jsonResponse(res, 400, { error: 'Informe um email valido.' });
    return;
  }

  if (password.length < 8) {
    jsonResponse(res, 400, { error: 'A senha deve ter pelo menos 8 caracteres.' });
    return;
  }

  const isConfiguredGlobalAdmin = config.globalAdminEmails.includes(email);
  const result = await storageService.transaction(async (repository) => {
    const existing = await repository.findUserByEmail(email);
    if (existing) {
      return { exists: true };
    }

    let inviteTeam = null;
    let invite = null;
    if (inviteCode) {
      const teams = await repository.listTeams();
      for (const team of teams) {
        const foundInvite = (Array.isArray(team.invites) ? team.invites : []).find((item) => item?.code === inviteCode);
        if (foundInvite) {
          inviteTeam = team;
          invite = foundInvite;
          break;
        }
      }

      if (!invite || !inviteTeam) {
        return { invalidInvite: true };
      }

      if (normalizeEmail(invite.email) !== email) {
        return { emailMismatch: true };
      }

      invite.role = normalizeTeamRole(invite.role);
      if (!invite.role) {
        return { invalidInvite: true };
      }
    }

    const now = new Date().toISOString();
    const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
    const user = {
      id: randomUUID(),
      email,
      name,
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      phone: '',
      initials: userInitials(name),
      globalAdmin: isConfiguredGlobalAdmin,
      passwordHash,
      teamMemberships: inviteTeam && invite ? [{ teamId: inviteTeam.id, role: invite.role }] : [],
      createdAt: now,
      updatedAt: now
    };

    await repository.createUser(user);

    if (inviteTeam && invite) {
      await repository.updateTeam(inviteTeam.id, (team) => ({
        ...team,
        invites: (Array.isArray(team.invites) ? team.invites : []).filter((item) => item?.code !== inviteCode),
        updatedAt: new Date().toISOString()
      }));
    }

    return { user, team: inviteTeam };
  });

  if (result.exists) {
    jsonResponse(res, 409, { error: 'Ja existe uma conta com este email.' });
    return;
  }

  if (result.invalidInvite) {
    jsonResponse(res, 404, { error: 'Convite invalido ou ja utilizado.' });
    return;
  }

  if (result.emailMismatch) {
    jsonResponse(res, 403, { error: 'Este convite foi emitido para outro email.' });
    return;
  }

  const user = publicUser(result.user);
  const token = signJwt(user);
  setAuthCookie(res, token);
  jsonResponse(res, 201, { token, user });
}

async function handleLogin(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Login maior que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const email = normalizeEmail(payload.email);
  const password = String(payload.password || '');
  const user = await storageService.findUserByEmail(email);
  const validPassword = user ? await bcrypt.compare(password, user.passwordHash || '') : false;

  if (!user || !validPassword) {
    jsonResponse(res, 401, { error: 'Email ou senha invalidos.' });
    return;
  }

  const responseUser = publicUser(user);
  const token = signJwt(responseUser);
  setAuthCookie(res, token);
  jsonResponse(res, 200, { token, user: responseUser });
}

async function handleForgotPassword(req, res) {
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

  const email = normalizeEmail(payload.email);
  if (!email || !email.includes('@')) {
    jsonResponse(res, 400, { error: 'Informe um email valido.' });
    return;
  }

  const resetCode = generatePasswordResetCode();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_CODE_TTL_MS).toISOString();
  const result = await storageService.transaction(async (repository) => {
    const user = await repository.findUserByEmail(email);
    if (!user) {
      return { userFound: false };
    }

    await repository.updateUser(user.id, (currentUser) => ({
      ...currentUser,
      passwordResetCodeHash: hashPasswordResetCode(email, resetCode),
      passwordResetExpiresAt: expiresAt,
      passwordResetRequestedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));

    return { userFound: true };
  });

  jsonResponse(res, 200, {
    ok: true,
    message: 'Se o email existir, um codigo de recuperacao foi gerado.',
    expiresInMinutes: Math.round(PASSWORD_RESET_CODE_TTL_MS / 60000)
  });
}

async function handleResetPassword(req, res) {
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

  const email = normalizeEmail(payload.email);
  const code = safeText(payload.code, 20).replace(/\D/g, '');
  const password = String(payload.password || '');

  if (!email || !email.includes('@')) {
    jsonResponse(res, 400, { error: 'Informe um email valido.' });
    return;
  }

  if (!PASSWORD_RESET_CODE_PATTERN.test(code)) {
    jsonResponse(res, 400, { error: 'Informe o codigo de 6 digitos.' });
    return;
  }

  if (password.length < 8) {
    jsonResponse(res, 400, { error: 'A nova senha deve ter pelo menos 8 caracteres.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
  const result = await storageService.transaction(async (repository) => {
    const user = await repository.findUserByEmail(email);
    if (!user) {
      return { invalid: true };
    }

    const expiresAt = Date.parse(user.passwordResetExpiresAt || '');
    if (!user.passwordResetCodeHash || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      return { expired: true };
    }

    const expectedHash = hashPasswordResetCode(email, code);
    if (!safeStringEqual(user.passwordResetCodeHash, expectedHash)) {
      return { invalid: true };
    }

    const updatedUser = await repository.updateUser(user.id, (currentUser) => {
      const nextUser = {
        ...currentUser,
        passwordHash,
        updatedAt: new Date().toISOString()
      };

      delete nextUser.passwordResetCodeHash;
      delete nextUser.passwordResetExpiresAt;
      delete nextUser.passwordResetRequestedAt;
      return nextUser;
    });

    return { user: updatedUser };
  });

  if (result.expired) {
    jsonResponse(res, 400, { error: 'Codigo expirado. Solicite um novo codigo.' });
    return;
  }

  if (result.invalid || !result.user) {
    jsonResponse(res, 401, { error: 'Codigo invalido.' });
    return;
  }

  const user = publicUser(result.user);
  const token = signJwt(user);
  setAuthCookie(res, token);
  jsonResponse(res, 200, { token, user });
}

async function handleLogout(res) {
  clearAuthCookie(res);
  jsonResponse(res, 200, { ok: true });
}

async function handleMe(req, res) {
  const user = await getRequestUser(req);
  if (!user) {
    jsonResponse(res, 200, { user: null });
    return;
  }

  jsonResponse(res, 200, { user });
}

async function handleUpdateMe(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Dados da conta maiores que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const user = await getRequestUser(req);
  if (!user) {
    jsonResponse(res, 401, { error: 'Autenticacao necessaria.' });
    return;
  }

  const hasOwn = (field) => Object.prototype.hasOwnProperty.call(payload, field);
  const updatesAvatar = hasOwn('avatarDataUrl');
  const updatesProfile = hasOwn('firstName') || hasOwn('lastName') || hasOwn('phone');
  const updatesPassword = hasOwn('currentPassword') || hasOwn('newPassword');

  if (!updatesAvatar && !updatesProfile && !updatesPassword) {
    jsonResponse(res, 400, { error: 'Informe os dados da conta para atualizar.' });
    return;
  }

  let parsedAvatar = null;
  if (updatesAvatar) {
    parsedAvatar = parseProfilePhotoDataUrl(payload.avatarDataUrl);
    if (parsedAvatar.error) {
      jsonResponse(res, 400, { error: parsedAvatar.error });
      return;
    }
  }

  let profileFields = null;
  if (updatesProfile) {
    const firstName = safeText(payload.firstName, 80);
    const lastName = safeText(payload.lastName, 120);
    const phone = normalizePhone(payload.phone);
    const name = joinNameParts(firstName, lastName);

    if (!firstName) {
      jsonResponse(res, 400, { error: 'Informe o nome.' });
      return;
    }

    profileFields = {
      firstName,
      lastName,
      phone,
      name,
      initials: userInitials(name)
    };
  }

  let nextPasswordHash = null;
  if (updatesPassword) {
    const currentPassword = String(payload.currentPassword || '');
    const newPassword = String(payload.newPassword || '');

    if (!currentPassword || !newPassword) {
      jsonResponse(res, 400, { error: 'Informe a senha atual e a nova senha.' });
      return;
    }

    if (newPassword.length < 8) {
      jsonResponse(res, 400, { error: 'A nova senha deve ter pelo menos 8 caracteres.' });
      return;
    }

    const storedUser = await storageService.findUserById(user.id);
    const validPassword = storedUser ? await bcrypt.compare(currentPassword, storedUser.passwordHash || '') : false;
    if (!validPassword) {
      jsonResponse(res, 401, { error: 'Senha atual invalida.' });
      return;
    }

    nextPasswordHash = await bcrypt.hash(newPassword, PASSWORD_HASH_ROUNDS);
  }

  const updatedUser = await storageService.transaction((repository) =>
    repository.updateUser(user.id, (currentUser) => {
      const nextUser = {
        ...currentUser,
        updatedAt: new Date().toISOString()
      };

      if (parsedAvatar) {
        nextUser.avatarDataUrl = parsedAvatar.avatarDataUrl;
      }

      if (profileFields) {
        Object.assign(nextUser, profileFields);
      }

      if (nextPasswordHash) {
        nextUser.passwordHash = nextPasswordHash;
      }

      return nextUser;
    })
  );

  if (!updatedUser) {
    jsonResponse(res, 404, { error: 'Usuario nao encontrado.' });
    return;
  }

  jsonResponse(res, 200, { user: publicUser(updatedUser) });
}

async function handleDeleteMe(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Confirmacao maior que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const user = await getRequestUser(req);
  if (!user) {
    jsonResponse(res, 401, { error: 'Autenticacao necessaria.' });
    return;
  }

  if (safeText(payload.confirmation, 40).toUpperCase() !== 'EXCLUIR') {
    jsonResponse(res, 400, { error: 'Digite EXCLUIR para confirmar.' });
    return;
  }

  const result = await storageService.transaction((repository) =>
    deleteUserAccountData(repository, user.id, {
      protectLastTeamAdmin: !isGlobalAdmin(user)
    })
  );

  if (result.missing) {
    clearAuthCookie(res);
    jsonResponse(res, 404, { error: 'Usuario nao encontrado.' });
    return;
  }

  if (result.lastAdminTeams?.length) {
    jsonResponse(res, 400, {
      error: `Voce e o unico admin em: ${result.lastAdminTeams.join(', ')}. Promova outro admin antes de excluir a conta.`
    });
    return;
  }

  await Promise.all(result.storageNames.map((storageName) => storageService.removeVideoFile(storageName)));

  clearAuthCookie(res);
  jsonResponse(res, 200, {
    ok: true,
    deletedVideos: result.deletedVideos,
    deletedPlaylists: result.deletedPlaylists
  });
}

async function handleListAdminUsers(req, res) {
  const admin = await requireGlobalAdmin(req, res);
  if (!admin) {
    return;
  }

  const users = await storageService.transaction(async (repository) => {
    const [allUsers, teams] = await Promise.all([repository.listUsers(), repository.listTeams()]);
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    return allUsers.map((user) => adminUserSummary(user, teamsById)).sort((left, right) =>
      String(left.name || left.email).localeCompare(String(right.name || right.email), 'pt-BR', {
        sensitivity: 'base'
      })
    );
  });

  jsonResponse(res, 200, { users });
}

async function handleDeleteAdminUser(req, res, userId) {
  const admin = await requireGlobalAdmin(req, res);
  if (!admin) {
    return;
  }

  const targetUserId = safeText(decodeURIComponent(userId), 100);
  if (!targetUserId) {
    jsonResponse(res, 400, { error: 'Usuario invalido.' });
    return;
  }

  if (targetUserId === admin.id) {
    jsonResponse(res, 400, { error: 'Use a opcao Excluir minha conta para remover sua propria conta.' });
    return;
  }

  const result = await storageService.transaction((repository) =>
    deleteUserAccountData(repository, targetUserId, {
      protectLastTeamAdmin: false
    })
  );

  if (result.missing) {
    jsonResponse(res, 404, { error: 'Usuario nao encontrado.' });
    return;
  }

  await Promise.all(result.storageNames.map((storageName) => storageService.removeVideoFile(storageName)));

  jsonResponse(res, 200, {
    ok: true,
    deletedUserId: targetUserId,
    deletedVideos: result.deletedVideos,
    deletedPlaylists: result.deletedPlaylists
  });
}

module.exports = {
  getRequestUser,
  requireGlobalAdmin,
  authorizeRoles,
  getTeamIdFromRequest,
  accessScope,
  normalizeTeamRole,
  normalizeTeamMemberships,
  isGlobalAdmin,
  handleRegister,
  handleLogin,
  handleForgotPassword,
  handleResetPassword,
  handleLogout,
  handleMe,
  handleUpdateMe,
  handleDeleteMe,
  handleListAdminUsers,
  handleDeleteAdminUser
};
