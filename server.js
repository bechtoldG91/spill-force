const { config, validateConfig } = require('./config');

validateConfig();

const http = require('node:http');
const { jsonResponse, methodNotAllowed } = require('./storage');
const {
  handleListTeams,
  handleCreateTeam,
  handleGetTeam,
  handleUpdateTeam,
  handleDeleteTeam,
  handleLeaveTeam,
  handleListTeamInvites,
  handleCreateTeamInvite,
  handleDeleteTeamInvite,
  handleCreateTeamJoinRequest,
  handleListTeamJoinRequests,
  handleApproveTeamJoinRequest,
  handleCreateTeamRoleChangeRequest,
  handleListTeamRoleChangeRequests,
  handleApproveTeamRoleChangeRequest,
  handleListTeamMembers,
  handleUpdateTeamMember,
  handleUpdateOwnTeamMembership
} = require('./teams');
const { handleListPlaylists, handleCreatePlaylist, handleDeletePlaylist } = require('./playlists');
const {
  handleListVideos,
  handleCreateVideo,
  handleDeleteVideo,
  handleUpdateVideo,
  handleTrimVideo,
  handleLongCutVideo
} = require('./videos');
const { handleGetAnnotations, handlePutAnnotations } = require('./annotations');
const { serveVideo, serveStatic } = require('./static');
const {
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
} = require('./auth');

async function route(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = requestUrl;

  if (pathname === '/api/auth/register') {
    if (req.method === 'POST') {
      await handleRegister(req, res);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  if (pathname === '/api/auth/login') {
    if (req.method === 'POST') {
      await handleLogin(req, res);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  if (pathname === '/api/auth/forgot-password') {
    if (req.method === 'POST') {
      await handleForgotPassword(req, res);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  if (pathname === '/api/auth/reset-password') {
    if (req.method === 'POST') {
      await handleResetPassword(req, res);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  if (pathname === '/api/auth/logout') {
    if (req.method === 'POST') {
      await handleLogout(res);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  if (pathname === '/api/auth/me') {
    if (req.method === 'GET') {
      await handleMe(req, res);
      return;
    }
    if (req.method === 'PATCH') {
      await handleUpdateMe(req, res);
      return;
    }
    if (req.method === 'DELETE') {
      await handleDeleteMe(req, res);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  if (pathname === '/api/admin/users') {
    if (req.method === 'GET') {
      await handleListAdminUsers(req, res);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const adminUserMatch = /^\/api\/admin\/users\/([^/]+)$/.exec(pathname);
  if (adminUserMatch) {
    if (req.method === 'DELETE') {
      await handleDeleteAdminUser(req, res, adminUserMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  if (pathname === '/api/teams') {
    if (req.method === 'GET') {
      await handleListTeams(req, res);
      return;
    }
    if (req.method === 'POST') {
      await handleCreateTeam(req, res);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const teamMembersMatch = /^\/api\/teams\/([^/]+)\/members$/.exec(pathname);
  if (teamMembersMatch) {
    if (req.method === 'GET') {
      await handleListTeamMembers(req, res, teamMembersMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const teamInvitesMatch = /^\/api\/teams\/([^/]+)\/invites$/.exec(pathname);
  if (teamInvitesMatch) {
    if (req.method === 'GET') {
      await handleListTeamInvites(req, res, teamInvitesMatch[1]);
      return;
    }
    if (req.method === 'POST') {
      await handleCreateTeamInvite(req, res, teamInvitesMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const teamInviteMatch = /^\/api\/teams\/([^/]+)\/invites\/([^/]+)$/.exec(pathname);
  if (teamInviteMatch) {
    if (req.method === 'DELETE') {
      await handleDeleteTeamInvite(req, res, teamInviteMatch[1], teamInviteMatch[2]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const teamJoinRequestsMatch = /^\/api\/teams\/([^/]+)\/join-requests$/.exec(pathname);
  if (teamJoinRequestsMatch) {
    if (req.method === 'GET') {
      await handleListTeamJoinRequests(req, res, teamJoinRequestsMatch[1]);
      return;
    }
    if (req.method === 'POST') {
      await handleCreateTeamJoinRequest(req, res, teamJoinRequestsMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const teamJoinApproveMatch = /^\/api\/teams\/([^/]+)\/join-requests\/([^/]+)\/approve$/.exec(pathname);
  if (teamJoinApproveMatch) {
    if (req.method === 'POST') {
      await handleApproveTeamJoinRequest(req, res, teamJoinApproveMatch[1], teamJoinApproveMatch[2]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const teamRoleChangeRequestsMatch = /^\/api\/teams\/([^/]+)\/role-change-requests$/.exec(pathname);
  if (teamRoleChangeRequestsMatch) {
    if (req.method === 'GET') {
      await handleListTeamRoleChangeRequests(req, res, teamRoleChangeRequestsMatch[1]);
      return;
    }
    if (req.method === 'POST') {
      await handleCreateTeamRoleChangeRequest(req, res, teamRoleChangeRequestsMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const teamRoleChangeApproveMatch = /^\/api\/teams\/([^/]+)\/role-change-requests\/([^/]+)\/approve$/.exec(pathname);
  if (teamRoleChangeApproveMatch) {
    if (req.method === 'POST') {
      await handleApproveTeamRoleChangeRequest(req, res, teamRoleChangeApproveMatch[1], teamRoleChangeApproveMatch[2]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const teamLeaveMatch = /^\/api\/teams\/([^/]+)\/leave$/.exec(pathname);
  if (teamLeaveMatch) {
    if (req.method === 'DELETE') {
      await handleLeaveTeam(req, res, teamLeaveMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const teamOwnMembershipMatch = /^\/api\/teams\/([^/]+)\/my-membership$/.exec(pathname);
  if (teamOwnMembershipMatch) {
    if (req.method === 'PATCH') {
      await handleUpdateOwnTeamMembership(req, res, teamOwnMembershipMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const teamMemberMatch = /^\/api\/teams\/([^/]+)\/members\/([^/]+)$/.exec(pathname);
  if (teamMemberMatch) {
    if (req.method === 'PATCH') {
      await handleUpdateTeamMember(req, res, teamMemberMatch[1], teamMemberMatch[2]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const teamDetailsMatch = /^\/api\/teams\/([^/]+)$/.exec(pathname);
  if (teamDetailsMatch) {
    if (req.method === 'GET') {
      await handleGetTeam(req, res, teamDetailsMatch[1]);
      return;
    }
    if (req.method === 'PATCH') {
      await handleUpdateTeam(req, res, teamDetailsMatch[1]);
      return;
    }
    if (req.method === 'DELETE') {
      await handleDeleteTeam(req, res, teamDetailsMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  if (pathname === '/api/playlists') {
    if (req.method === 'GET') {
      await handleListPlaylists(req, res);
      return;
    }
    if (req.method === 'POST') {
      await handleCreatePlaylist(req, res);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const playlistDeleteMatch = /^\/api\/playlists\/([^/]+)$/.exec(pathname);
  if (playlistDeleteMatch) {
    if (req.method === 'DELETE') {
      await handleDeletePlaylist(req, res, playlistDeleteMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  if (pathname === '/api/videos') {
    if (req.method === 'GET') {
      await handleListVideos(req, res);
      return;
    }
    if (req.method === 'POST') {
      await handleCreateVideo(req, res, requestUrl);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const videoDeleteMatch = /^\/api\/videos\/([a-f0-9-]{36})$/.exec(pathname);
  if (videoDeleteMatch) {
    if (req.method === 'DELETE') {
      await handleDeleteVideo(req, res, videoDeleteMatch[1]);
      return;
    }
    if (req.method === 'PATCH') {
      await handleUpdateVideo(req, res, videoDeleteMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const videoTrimMatch = /^\/api\/videos\/([a-f0-9-]{36})\/trim$/.exec(pathname);
  if (videoTrimMatch) {
    if (req.method === 'POST') {
      await handleTrimVideo(req, res, videoTrimMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const videoLongCutMatch = /^\/api\/videos\/([a-f0-9-]{36})\/long-cut$/.exec(pathname);
  if (videoLongCutMatch) {
    if (req.method === 'POST') {
      await handleLongCutVideo(req, res, videoLongCutMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  const annotationsMatch = /^\/api\/videos\/([a-f0-9-]{36})\/annotations$/.exec(pathname);
  if (annotationsMatch) {
    if (req.method === 'GET') {
      await handleGetAnnotations(req, res, annotationsMatch[1]);
      return;
    }
    if (req.method === 'PUT') {
      await handlePutAnnotations(req, res, annotationsMatch[1]);
      return;
    }
    methodNotAllowed(res);
    return;
  }

  if (pathname.startsWith('/api/')) {
    jsonResponse(res, 404, { error: 'Rota nao encontrada.' });
    return;
  }

  if (pathname.startsWith('/videos/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      methodNotAllowed(res);
      return;
    }
    await serveVideo(req, res, requestUrl);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    methodNotAllowed(res);
    return;
  }

  await serveStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (error.code === 'ENOENT') {
      jsonResponse(res, 404, { error: 'Nao encontrado.' });
      return;
    }

    console.error(error);
    if (!res.headersSent) {
      jsonResponse(res, 500, { error: 'Erro interno do servidor.' });
    } else {
      res.end();
    }
  });
});

function listen(port, remainingAttempts = config.isProduction ? 0 : 10) {
  const onListening = () => {
    server.off('error', onError);
    const displayHost = config.host && config.host !== '0.0.0.0' ? config.host : 'localhost';
    console.log(`Spill&Force rodando em http://${displayHost}:${port}`);
  };

  const onError = (error) => {
    server.off('listening', onListening);

    if (error.code === 'EADDRINUSE' && remainingAttempts > 0) {
      listen(port + 1, remainingAttempts - 1);
      return;
    }

    console.error(error);
    process.exit(1);
  };

  server.once('error', onError);
  server.once('listening', onListening);
  if (config.host) {
    server.listen(port, config.host);
    return;
  }

  server.listen(port);
}

listen(config.port);
