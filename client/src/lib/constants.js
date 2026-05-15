export const APP_USER = {
  initials: 'CG',
  name: 'Coach Gui',
  email: 'gbechtold91@gmail.com',
  role: 'Treinador',
  team: 'Loco',
  unit: 'Comissao tecnica',
  teams: [
    {
      id: 'loco',
      name: 'Loco',
      role: 'Comissao tecnica',
      note: 'Equipe principal'
    }
  ]
};

export const NAV_ITEMS = [
  { to: '/', label: 'Inicio', icon: 'home' },
  { to: '/time', label: 'Clube', icon: 'team', requiresTeam: true },
  {
    label: 'Video',
    icon: 'film',
    items: [
      { to: '/upload', label: 'Upload', icon: 'upload', roles: ['admin', 'treinador'] },
      { to: '/biblioteca', label: 'Biblioteca', icon: 'library', requiresTeam: true },
      { to: '/analise', label: 'Analise', icon: 'analysis', requiresTeam: true }
    ]
  }
];

export const SWATCHES = ['#3f8f29', '#78c93c', '#002244', '#1b5e9b', '#ffffff'];

export const MARKER_TOLERANCE = 0.18;
