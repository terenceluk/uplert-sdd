import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  buildSessionCookie,
  buildClearSessionCookie,
} from '../services/auth-service.js';

const MAX_LOGIN_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 1024;

export function registerAuthRoutes({ db, addRoute }) {
  addRoute('POST', '/api/register', makeRegisterHandler(db));
  addRoute('POST', '/api/login', makeLoginHandler(db));
  addRoute('POST', '/api/logout', makeLogoutHandler(db));
}

function makeRegisterHandler(db) {
  return ({ body, sendJson, res }) => {
    const { login, password } = body;

    if (
      typeof login !== 'string' ||
      login.length === 0 ||
      typeof password !== 'string' ||
      password.length === 0
    ) {
      return sendJson(res, 400, { error: 'login and password are required' });
    }
    if (login.length > MAX_LOGIN_LENGTH) {
      return sendJson(res, 400, {
        error: `login must be at most ${MAX_LOGIN_LENGTH} characters`,
      });
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return sendJson(res, 400, {
        error: `password must be at most ${MAX_PASSWORD_LENGTH} characters`,
      });
    }

    const existing = db.prepare('SELECT id FROM users WHERE login = ?').get(login);
    if (existing) {
      return sendJson(res, 409, { error: 'login already taken' });
    }

    const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const role = userCount === 0 ? 'admin' : 'user';

    const { hash, salt } = hashPassword(password);
    const now = new Date().toISOString();
    const result = db
      .prepare(
        'INSERT INTO users (login, password_hash, password_salt, role, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(login, hash, salt, role, now);

    return sendJson(res, 201, { id: Number(result.lastInsertRowid), login, role });
  };
}

function makeLoginHandler(db) {
  return ({ body, sendJson, res }) => {
    const genericError = { error: 'invalid login or password' };
    const { login, password } = body;

    if (typeof login !== 'string' || typeof password !== 'string') {
      return sendJson(res, 401, genericError);
    }

    const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login);
    if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
      return sendJson(res, 401, genericError);
    }

    const token = createSession(db, user.id);
    return sendJson(
      res,
      200,
      { id: user.id, login: user.login, role: user.role },
      { 'Set-Cookie': buildSessionCookie(token) }
    );
  };
}

function makeLogoutHandler(db) {
  return ({ cookies, res }) => {
    destroySession(db, cookies.session);
    res.writeHead(204, { 'Set-Cookie': buildClearSessionCookie() });
    res.end();
  };
}
