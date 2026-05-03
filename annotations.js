const { randomUUID } = require('node:crypto');
const {
  storageService,
  jsonResponse,
  safeText,
  readJsonBody
} = require('./storage');
const { accessScope, authorizeRoles, getTeamIdFromRequest } = require('./auth');

function normalizePoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x: Math.max(0, Math.min(1, Number(x.toFixed(5)))),
    y: Math.max(0, Math.min(1, Number(y.toFixed(5))))
  };
}

function normalizeStroke(stroke) {
  const points = Array.isArray(stroke?.points)
    ? stroke.points.map(normalizePoint).filter(Boolean).slice(0, 1200)
    : [];

  if (points.length < 2) {
    return null;
  }

  const width = Number(stroke?.width);
  const color = /^#[0-9a-f]{6}$/i.test(String(stroke?.color || '')) ? stroke.color : '#caff42';

  return {
    color,
    width: Number.isFinite(width) ? Math.max(2, Math.min(18, Math.round(width))) : 5,
    points
  };
}

function normalizeBox(box) {
  const x = Number(box?.x);
  const y = Number(box?.y);
  const width = Number(box?.width);
  const text = safeText(box?.text, 240);
  const color = /^#[0-9a-f]{6}$/i.test(String(box?.color || '')) ? box.color : '#caff42';

  if (!text || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    id: safeText(box?.id, 80) || randomUUID(),
    x: Math.max(0, Math.min(1, Number(x.toFixed(5)))),
    y: Math.max(0, Math.min(1, Number(y.toFixed(5)))),
    width: Number.isFinite(width) ? Math.max(0.12, Math.min(0.55, Number(width.toFixed(5)))) : 0.24,
    text,
    color
  };
}

function normalizeAnnotation(annotation) {
  const time = Number(annotation?.time);
  if (!Number.isFinite(time) || time < 0) {
    return null;
  }

  const strokes = Array.isArray(annotation?.strokes)
    ? annotation.strokes.map(normalizeStroke).filter(Boolean).slice(0, 40)
    : [];
  const boxes = Array.isArray(annotation?.boxes)
    ? annotation.boxes.map(normalizeBox).filter(Boolean).slice(0, 20)
    : [];
  const text = safeText(annotation?.text, 900);

  if (!text && strokes.length === 0 && boxes.length === 0) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    id: safeText(annotation?.id, 80) || randomUUID(),
    time: Number(time.toFixed(2)),
    text,
    color: /^#[0-9a-f]{6}$/i.test(String(annotation?.color || '')) ? annotation.color : '#caff42',
    strokes,
    boxes,
    createdAt: safeText(annotation?.createdAt, 40) || now,
    updatedAt: now
  };
}

async function ensureVideoExists(repository, id, scope) {
  return Boolean(await repository.findVideoById(id, scope));
}

async function handleGetAnnotations(req, res, id) {
  const teamId = getTeamIdFromRequest(req);
  const access = await authorizeRoles(req, res, teamId, ['admin', 'treinador', 'atleta']);
  if (!access) {
    return;
  }
  const scope = accessScope(access);
  const result = await storageService.transaction(async (repository) => {
    if (!(await ensureVideoExists(repository, id, scope))) {
      return null;
    }

    return repository.getAnnotations(id);
  });

  if (result === null) {
    jsonResponse(res, 404, { error: 'Video nao encontrado.' });
    return;
  }

  jsonResponse(res, 200, { annotations: result });
}

async function handlePutAnnotations(req, res, id) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'JSON_BODY_LIMIT_EXCEEDED') {
      jsonResponse(res, 413, { error: 'Anotacoes maiores que o limite permitido.' });
      return;
    }
    if (error instanceof SyntaxError) {
      jsonResponse(res, 400, { error: 'JSON invalido.' });
      return;
    }
    throw error;
  }

  const teamId = getTeamIdFromRequest(req, null, payload);
  const access = await authorizeRoles(req, res, teamId, ['admin', 'treinador']);
  if (!access) {
    return;
  }
  const scope = accessScope(access);
  const videoExists = await storageService.transaction((repository) => ensureVideoExists(repository, id, scope));

  if (!videoExists) {
    jsonResponse(res, 404, { error: 'Video nao encontrado.' });
    return;
  }

  const annotations = Array.isArray(payload.annotations)
    ? payload.annotations.map(normalizeAnnotation).filter(Boolean).slice(0, 100)
    : [];

  annotations.sort((a, b) => a.time - b.time);

  await storageService.transaction((repository) => repository.saveAnnotations(id, annotations));

  jsonResponse(res, 200, { annotations });
}

module.exports = {
  handleGetAnnotations,
  handlePutAnnotations
};
