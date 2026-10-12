import { randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE = "meshlink_session";
const MAX_AGE = 3600;

type Session = { expiresAt: number };

export type DashboardAuth = {
  login(password: string): { ok: true; cookie: string } | { ok: false };
  valid(token: string | undefined): boolean;
  clearCookie: string;
  cookieName: string;
};

export function createDashboardAuth(expectedPassword: string, now = (): number => Date.now(), secure = false): DashboardAuth {
  const sessions = new Map<string, Session>();
  const cookie = (token: string, maxAge: number): string => `${COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
  return {
    cookieName: COOKIE,
    clearCookie: cookie("", 0),
    login(password) {
      const supplied = Buffer.from(password);
      const expected = Buffer.from(expectedPassword);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return { ok: false };
      const token = randomBytes(32).toString("base64url");
      sessions.set(token, { expiresAt: now() + MAX_AGE * 1000 });
      return { ok: true, cookie: cookie(token, MAX_AGE) };
    },
    valid(token) {
      if (!token) return false;
      const session = sessions.get(token);
      if (!session || session.expiresAt <= now()) {
        sessions.delete(token);
        return false;
      }
      return true;
    },
  };
}

export function dashboardPassword(): { password: string; fallback: boolean } {
  const password = process.env.MESHLINK_DASHBOARD_PASSWORD;
  return { password: password ?? "meshlink", fallback: password === undefined };
}
