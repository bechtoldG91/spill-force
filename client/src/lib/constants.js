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
  {
    label: 'Clube',
    icon: 'team',
    items: [
      { to: '/time', label: 'Meu clube', icon: 'team' },
      { to: '/club-manage', label: 'Club manage', icon: 'settings', manageClubOnly: true }
    ]
  },
  {
    label: 'Video',
    icon: 'film',
    items: [
      { to: '/upload', label: 'Upload', icon: 'upload' },
      { to: '/biblioteca', label: 'Biblioteca', icon: 'library' },
      { to: '/analise', label: 'Analise', icon: 'analysis' }
    ]
  },
  { to: '/noticias', label: 'Noticias', icon: 'news' }
];

export const SWATCHES = ['#3f8f29', '#78c93c', '#002244', '#1b5e9b', '#ffffff'];

export const MARKER_TOLERANCE = 0.18;
