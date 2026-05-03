function createJsonRepository({
  readVideos,
  writeVideos,
  readPlaylists,
  writePlaylists,
  readAnnotations,
  writeAnnotations,
  readAccount,
  writeAccount,
  readUsers,
  writeUsers,
  readTeams,
  writeTeams,
  legacyOwnerId
}) {
  function ownsRecord(record, ownerId, teamId) {
    if (teamId) {
      return record?.teamId === teamId;
    }

    if (record?.teamId) {
      return false;
    }

    if (!ownerId) {
      return true;
    }

    return record?.ownerId === ownerId || (!record?.ownerId && ownerId === legacyOwnerId);
  }

  function scoped(records, ownerId, teamId) {
    return ownerId || teamId ? records.filter((record) => ownsRecord(record, ownerId, teamId)) : records;
  }

  function mergeScopedRecords(allRecords, scopedRecords, ownerId, teamId) {
    if (!ownerId && !teamId) {
      return scopedRecords;
    }

    return [...scopedRecords, ...allRecords.filter((record) => !ownsRecord(record, ownerId, teamId))];
  }

  return {
    async listVideos({ ownerId, teamId } = {}) {
      const videos = await readVideos();
      return scoped(videos, ownerId, teamId);
    },

    async findVideoById(id, { ownerId, teamId } = {}) {
      const videos = await readVideos();
      return videos.find((video) => video.id === id && ownsRecord(video, ownerId, teamId)) || null;
    },

    async findVideoByStorageName(storageName, { ownerId, teamId } = {}) {
      const videos = await readVideos();
      return videos.find((video) => video.storageName === storageName && ownsRecord(video, ownerId, teamId)) || null;
    },

    async createVideo(video) {
      const videos = await readVideos();
      videos.unshift(video);
      await writeVideos(videos);
      return video;
    },

    async saveVideos(videos, { ownerId, teamId } = {}) {
      const allVideos = await readVideos();
      const nextVideos = mergeScopedRecords(allVideos, videos, ownerId, teamId);
      await writeVideos(nextVideos);
      return videos;
    },

    async updateVideo(id, updater, { ownerId, teamId } = {}) {
      const videos = await readVideos();
      const index = videos.findIndex((video) => video.id === id && ownsRecord(video, ownerId, teamId));

      if (index === -1) {
        return null;
      }

      const nextVideo = typeof updater === 'function' ? updater(videos[index], videos) : { ...videos[index], ...updater };
      videos[index] = nextVideo;
      await writeVideos(videos);
      return nextVideo;
    },

    async deleteVideo(id, { ownerId, teamId } = {}) {
      const videos = await readVideos();
      const index = videos.findIndex((video) => video.id === id && ownsRecord(video, ownerId, teamId));

      if (index === -1) {
        return null;
      }

      const [video] = videos.splice(index, 1);
      await writeVideos(videos);
      return video;
    },

    async listPlaylists({ ownerId, teamId } = {}) {
      const playlists = await readPlaylists();
      return scoped(playlists, ownerId, teamId);
    },

    async findPlaylistById(id, { ownerId, teamId } = {}) {
      const playlists = await readPlaylists();
      return playlists.find((playlist) => playlist.id === id && ownsRecord(playlist, ownerId, teamId)) || null;
    },

    async createPlaylist(playlist) {
      const playlists = await readPlaylists();
      playlists.push(playlist);
      await writePlaylists(playlists);
      return playlist;
    },

    async savePlaylists(playlists, { ownerId, teamId } = {}) {
      const allPlaylists = await readPlaylists();
      const nextPlaylists = mergeScopedRecords(allPlaylists, playlists, ownerId, teamId);
      await writePlaylists(nextPlaylists);
      return playlists;
    },

    async deletePlaylist(id, { ownerId, teamId } = {}) {
      const playlists = await readPlaylists();
      const index = playlists.findIndex((playlist) => playlist.id === id && ownsRecord(playlist, ownerId, teamId));

      if (index === -1) {
        return null;
      }

      const [playlist] = playlists.splice(index, 1);
      await writePlaylists(playlists);
      return playlist;
    },

    async getAnnotations(videoId) {
      const store = await readAnnotations();
      return Array.isArray(store[videoId]) ? store[videoId] : [];
    },

    async listAnnotations(videoId) {
      const store = await readAnnotations();
      return Array.isArray(store[videoId]) ? store[videoId] : [];
    },

    async saveAnnotation(videoId, annotation) {
      const store = await readAnnotations();
      const annotations = Array.isArray(store[videoId]) ? store[videoId] : [];
      const nextAnnotations = Array.isArray(annotation) ? annotation : [...annotations, annotation];
      store[videoId] = nextAnnotations;
      await writeAnnotations(store);
      return nextAnnotations;
    },

    async saveAnnotations(videoId, annotations) {
      const store = await readAnnotations();
      store[videoId] = annotations;
      await writeAnnotations(store);
      return annotations;
    },

    async deleteAnnotations(videoId) {
      const store = await readAnnotations();

      if (!store[videoId]) {
        return false;
      }

      delete store[videoId];
      await writeAnnotations(store);
      return true;
    },

    async deleteAnnotationsForVideos(videoIds) {
      const store = await readAnnotations();
      let changed = false;

      videoIds.forEach((videoId) => {
        if (store[videoId]) {
          delete store[videoId];
          changed = true;
        }
      });

      if (changed) {
        await writeAnnotations(store);
      }

      return changed;
    },

    async getAccount() {
      return readAccount();
    },

    async saveAccount(account) {
      await writeAccount(account);
      return account;
    },

    async updateAccount(updater) {
      const account = await readAccount();
      const nextAccount = await updater(account);
      await writeAccount(nextAccount);
      return nextAccount;
    },

    async listUsers() {
      return readUsers();
    },

    async findUserByEmail(email) {
      const users = await readUsers();
      const normalizedEmail = String(email || '').toLowerCase();
      return users.find((user) => user.email === normalizedEmail) || null;
    },

    async findUserById(id) {
      const users = await readUsers();
      return users.find((user) => user.id === id) || null;
    },

    async createUser(user) {
      const users = await readUsers();
      users.push(user);
      await writeUsers(users);
      return user;
    },

    async updateUser(id, updater) {
      const users = await readUsers();
      const index = users.findIndex((user) => user.id === id);

      if (index === -1) {
        return null;
      }

      const nextUser = typeof updater === 'function' ? updater(users[index], users) : { ...users[index], ...updater };
      users[index] = nextUser;
      await writeUsers(users);
      return nextUser;
    },

    async listTeams() {
      return readTeams();
    },

    async findTeamById(id) {
      const teams = await readTeams();
      return teams.find((team) => team.id === id) || null;
    },

    async createTeam(team) {
      const teams = await readTeams();
      teams.push(team);
      await writeTeams(teams);
      return team;
    },

    async updateTeam(id, updater) {
      const teams = await readTeams();
      const index = teams.findIndex((team) => team.id === id);

      if (index === -1) {
        return null;
      }

      const nextTeam = typeof updater === 'function' ? updater(teams[index], teams) : { ...teams[index], ...updater };
      teams[index] = nextTeam;
      await writeTeams(teams);
      return nextTeam;
    },

    async saveTeams(teams) {
      await writeTeams(teams);
      return teams;
    },

    async listTeamMembers(teamId) {
      const users = await readUsers();
      return users
        .map((user) => {
          const membership = (Array.isArray(user.teamMemberships) ? user.teamMemberships : []).find((item) => item.teamId === teamId);
          if (!membership) {
            return null;
          }

          return {
            user,
            role: membership.role,
            membership
          };
        })
        .filter(Boolean);
    }
  };
}

module.exports = {
  createJsonRepository
};
