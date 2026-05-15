export function cn(...values) {
  return values.filter(Boolean).join(' ');
}

export function normalizeText(value) {
  return String(value || '').toLocaleLowerCase('pt-BR');
}

export function normalizeRole(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function hasAnyTeamRole(user, roles = []) {
  if (user?.globalAdmin) {
    return true;
  }

  const allowedRoles = new Set((Array.isArray(roles) ? roles : [roles]).map(normalizeRole).filter(Boolean));
  if (!allowedRoles.size) {
    return true;
  }

  return (user?.teamMemberships || []).some((membership) => allowedRoles.has(normalizeRole(membership.role)));
}

export function isTeamManagerRole(role) {
  return ['admin', 'treinador'].includes(normalizeRole(role));
}

export function canManageTeamSettings(user) {
  return Boolean(user?.globalAdmin || (user?.teamMemberships || []).some((membership) => isTeamManagerRole(membership.role)));
}

export function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
  }

  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

export function formatBytes(bytes = 0) {
  if (!bytes) {
    return '0 MB';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function kindLabel(kind) {
  const labels = {
    jogo: 'Jogo',
    treino: 'Treino',
    highlight: 'Highlight',
    analise: 'Analise'
  };

  return labels[kind] || kind || 'Video';
}

export function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}
