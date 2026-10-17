import { getSessionUser } from '../services/auth-service.js';
import {
  createCheck,
  listChecksForUser,
  deleteCheck,
  updateCheckWebhook,
} from '../services/check-service.js';
import { validateWebhookUrl } from '../services/webhook-service.js';
import { buildCheckView } from '../services/uptime-service.js';

export function registerCheckRoutes({ db, addRoute }) {
  addRoute('GET', '/api/checks', makeListHandler(db));
  addRoute('POST', '/api/checks', makeCreateHandler(db));
  addRoute('DELETE', '/api/checks/:id', makeDeleteHandler(db));
  addRoute('PATCH', '/api/checks/:id', makeUpdateWebhookHandler(db));
}

function makeListHandler(db) {
  return ({ cookies, sendJson, res }) => {
    const user = getSessionUser(db, cookies);
    if (!user) return sendJson(res, 401, { error: 'authentication required' });

    const checks = listChecksForUser(db, user.id);
    return sendJson(res, 200, checks.map((check) => buildCheckView(db, check)));
  };
}

function makeCreateHandler(db) {
  return async ({ cookies, body, sendJson, res }) => {
    const user = getSessionUser(db, cookies);
    if (!user) return sendJson(res, 401, { error: 'authentication required' });

    const { url, displayName, intervalSeconds, webhookUrl } = body;

    if (webhookUrl != null) {
      const webhookValidationError = await validateWebhookUrl(webhookUrl);
      if (webhookValidationError) return sendJson(res, 400, { error: webhookValidationError });
    }

    const result = await createCheck(db, user.id, { url, displayName, intervalSeconds });
    if (result.error) return sendJson(res, 400, { error: result.error });

    let check = result.check;
    if (webhookUrl != null) {
      check = updateCheckWebhook(db, user.id, check.id, webhookUrl);
    }

    return sendJson(res, 201, buildCheckView(db, check));
  };
}

function makeDeleteHandler(db) {
  return ({ cookies, params, sendJson, res }) => {
    const user = getSessionUser(db, cookies);
    if (!user) return sendJson(res, 401, { error: 'authentication required' });

    const checkId = Number(params.id);
    const deleted = deleteCheck(db, user.id, checkId);
    if (!deleted) return sendJson(res, 404, { error: 'not found' });

    res.writeHead(204);
    res.end();
  };
}

function makeUpdateWebhookHandler(db) {
  return async ({ cookies, params, body, sendJson, res }) => {
    const user = getSessionUser(db, cookies);
    if (!user) return sendJson(res, 401, { error: 'authentication required' });

    const webhookUrl = body.webhookUrl ?? null;
    if (webhookUrl !== null) {
      const validationError = await validateWebhookUrl(webhookUrl);
      if (validationError) return sendJson(res, 400, { error: validationError });
    }

    const checkId = Number(params.id);
    const updated = updateCheckWebhook(db, user.id, checkId, webhookUrl);
    if (!updated) return sendJson(res, 404, { error: 'not found' });

    return sendJson(res, 200, buildCheckView(db, updated));
  };
}
