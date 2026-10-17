import { getSessionUser } from '../services/auth-service.js';
import { getAdminRoster } from '../services/check-service.js';

export function registerAdminRoutes({ db, addRoute }) {
  addRoute('GET', '/api/admin/users', makeListUsersHandler(db));
}

function makeListUsersHandler(db) {
  return ({ cookies, sendJson, res }) => {
    const user = getSessionUser(db, cookies);
    if (!user) return sendJson(res, 401, { error: 'authentication required' });
    if (user.role !== 'admin') {
      return sendJson(res, 403, { error: 'administrator access required' });
    }

    return sendJson(res, 200, getAdminRoster(db));
  };
}
