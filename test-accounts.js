const { randomUUID } = require('node:crypto');
const { config } = require('./config');
const { storageService } = require('./storage');

const TEST_TEAM_ID = 'spill-force-test-club';
const TEST_TEAM_NAME = 'Clube de Teste';

const TEST_ACCOUNTS = [
  { email: 'admin@spillforce.test', name: 'Admin Teste', role: 'admin', passwordHash: '$2b$12$MFbJbtV2779k2JNvjbfTNO58WDWwb44WHO/th8J5KwNpaWzEnMWCq' },
  { email: 'tecnico@spillforce.test', name: 'Tecnico Teste', role: 'treinador', passwordHash: '$2b$12$y/qU.drtsonqEFnk3UdaNOSHYWKQDYwcDD.qkVjBSTPyJpmwY9/Ay' },
  { email: 'atleta@spillforce.test', name: 'Atleta Teste', role: 'atleta', passwordHash: '$2b$12$M2rPlN4FJ9IKtmkB0o28B.eH0X4zGh1Sh27iP3f98n1s0JXVz7532' }
];

async function seedTestAccounts() {
  if (!config.seedTestAccounts) {
    return;
  }

  await storageService.transaction(async (repository) => {
    const now = new Date().toISOString();
    const usersByRole = new Map();

    for (const account of TEST_ACCOUNTS) {
      const existing = await repository.findUserByEmail(account.email);
      if (existing && existing.demoAccount !== true) {
        throw new Error(`O email ${account.email} ja pertence a uma conta comum.`);
      }

      const membership = account.role === 'atleta'
        ? { teamId: TEST_TEAM_ID, role: account.role, nickname: 'Teste', jerseyNumber: '12', sector: 'ataque', position: 'QB' }
        : { teamId: TEST_TEAM_ID, role: account.role };

      let user;
      if (existing) {
        user = await repository.updateUser(existing.id, (current) => ({
          ...current,
          globalAdmin: false,
          passwordHash: account.passwordHash,
          teamMemberships: [
            ...(Array.isArray(current.teamMemberships) ? current.teamMemberships : []).filter((item) => item?.teamId !== TEST_TEAM_ID),
            { ...membership, ...(current.teamMemberships || []).find((item) => item?.teamId === TEST_TEAM_ID), role: account.role }
          ],
          updatedAt: now
        }));
      } else {
        const [firstName, ...lastName] = account.name.split(' ');
        user = {
          id: randomUUID(),
          email: account.email,
          name: account.name,
          firstName,
          lastName: lastName.join(' '),
          phone: '',
          initials: account.name.split(' ').map((part) => part[0]).join(''),
          globalAdmin: false,
          demoAccount: true,
          passwordHash: account.passwordHash,
          teamMemberships: [membership],
          createdAt: now,
          updatedAt: now
        };
        await repository.createUser(user);
      }

      usersByRole.set(account.role, user);
    }

    const adminId = usersByRole.get('admin').id;
    const existingTeam = await repository.findTeamById(TEST_TEAM_ID);
    if (existingTeam && existingTeam.name !== TEST_TEAM_NAME) {
      throw new Error('O identificador do clube de teste ja esta em uso.');
    }
    if (existingTeam) {
      await repository.updateTeam(TEST_TEAM_ID, (team) => ({ ...team, ownerIds: [adminId] }));
    } else {
      await repository.createTeam({
        id: TEST_TEAM_ID,
        name: TEST_TEAM_NAME,
        city: '',
        logoDataUrl: '',
        coverDataUrl: '',
        upcomingEvents: [],
        socialLinks: {},
        ownerIds: [adminId],
        invites: [],
        joinRequests: [],
        roleChangeRequests: []
      });
    }
  });

  console.info('[test-accounts] Clube e tres contas de teste prontos.');
}

module.exports = { seedTestAccounts, TEST_ACCOUNTS, TEST_TEAM_ID };
