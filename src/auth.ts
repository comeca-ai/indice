/** Auth: signup/login/logout/me — PBKDF2 + cookie de sessão opaca (D1). */

export interface AuthEnv {
  DB: D1Database;
  SESSION_SECRET: string;
}

export type AuthUser = {
  id: string;
  email: string;
  created_at: string;
};

const COOKIE_NAME = "indicie_session";
const SESSION_DAYS = 7;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_LENGTH = 32;

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function addDaysIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function bytesToHex(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function randomId(): string {
  return crypto.randomUUID();
}

function randomToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const dig = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(dig);
}

async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    PBKDF2_LENGTH * 8,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(bits)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = hexToBytes(parts[2]);
  const expected = parts[3];
  if (!iterations || salt.length === 0 || !expected) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    PBKDF2_LENGTH * 8,
  );
  return bytesToHex(bits) === expected;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function sessionCookie(token: string, maxAgeSec: number): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  return parts.join("; ");
}

function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function validPassword(password: string): boolean {
  return typeof password === "string" && password.length >= 8 && password.length <= 128;
}

export async function getSessionUser(
  request: Request,
  env: AuthEnv,
): Promise<AuthUser | null> {
  const cookies = parseCookies(request.headers.get("cookie"));
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  const tokenHash = await sha256Hex(`${env.SESSION_SECRET}:${token}`);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.created_at, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{ id: string; email: string; created_at: string; expires_at: string }>();

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
    return null;
  }
  return { id: row.id, email: row.email, created_at: row.created_at };
}

async function createSession(
  env: AuthEnv,
  userId: string,
): Promise<{ cookie: string }> {
  const id = randomId();
  const token = randomToken();
  const tokenHash = await sha256Hex(`${env.SESSION_SECRET}:${token}`);
  const created = nowIso();
  const expires = addDaysIso(SESSION_DAYS);
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, tokenHash, expires, created)
    .run();
  return { cookie: sessionCookie(token, SESSION_DAYS * 86_400) };
}

async function destroySession(request: Request, env: AuthEnv): Promise<void> {
  const cookies = parseCookies(request.headers.get("cookie"));
  const token = cookies[COOKIE_NAME];
  if (!token) return;
  const tokenHash = await sha256Hex(`${env.SESSION_SECRET}:${token}`);
  await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

async function handleSignup(request: Request, env: AuthEnv): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return json({ ok: false, error: "invalid_json" }, 400);

  const email = normalizeEmail(String(body.email ?? ""));
  const password = String(body.password ?? "");

  if (!validEmail(email)) return json({ ok: false, error: "email_invalido" }, 400);
  if (!validPassword(password)) {
    return json({ ok: false, error: "senha_invalida", hint: "mínimo 8 caracteres" }, 400);
  }

  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(email)
    .first();
  if (existing) return json({ ok: false, error: "email_em_uso" }, 409);

  const id = randomId();
  const passwordHash = await hashPassword(password);
  const created = nowIso();

  try {
    await env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`,
    )
      .bind(id, email, passwordHash, created)
      .run();
  } catch {
    return json({ ok: false, error: "email_em_uso" }, 409);
  }

  const { cookie } = await createSession(env, id);
  return json(
    { ok: true, user: { id, email, created_at: created } },
    201,
    { "set-cookie": cookie },
  );
}

async function handleLogin(request: Request, env: AuthEnv): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return json({ ok: false, error: "invalid_json" }, 400);

  const email = normalizeEmail(String(body.email ?? ""));
  const password = String(body.password ?? "");
  if (!email || !password) return json({ ok: false, error: "credenciais_invalidas" }, 400);

  const row = await env.DB.prepare(
    `SELECT id, email, password_hash, created_at FROM users WHERE email = ?`,
  )
    .bind(email)
    .first<{ id: string; email: string; password_hash: string; created_at: string }>();

  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return json({ ok: false, error: "credenciais_invalidas" }, 401);
  }

  const { cookie } = await createSession(env, row.id);
  return json(
    { ok: true, user: { id: row.id, email: row.email, created_at: row.created_at } },
    200,
    { "set-cookie": cookie },
  );
}

async function handleLogout(request: Request, env: AuthEnv): Promise<Response> {
  await destroySession(request, env);
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
}

async function handleMe(request: Request, env: AuthEnv): Promise<Response> {
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false, error: "nao_autenticado" }, 401);
  return json({ ok: true, user });
}

/** Rotas /auth/* — retorna Response ou null se path não for auth. */
export async function handleAuth(
  request: Request,
  env: AuthEnv,
  pathname: string,
): Promise<Response | null> {
  if (!pathname.startsWith("/auth")) return null;

  if (pathname === "/auth/signup" && request.method === "POST") {
    return handleSignup(request, env);
  }
  if (pathname === "/auth/login" && request.method === "POST") {
    return handleLogin(request, env);
  }
  if (pathname === "/auth/logout" && request.method === "POST") {
    return handleLogout(request, env);
  }
  if (pathname === "/auth/me" && request.method === "GET") {
    return handleMe(request, env);
  }

  return json({ ok: false, error: "not_found" }, 404);
}
