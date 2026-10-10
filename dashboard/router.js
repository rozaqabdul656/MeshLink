const configuredApiBase = () => {
  if (typeof window === "undefined") return "";
  const value = window.__MESHLINK_API_BASE__;
  return typeof value === "string" ? value.replace(/\/$/, "") : "";
};

export function dashboardConfig(value = configuredApiBase()) {
  return { apiBase: typeof value === "string" ? value.replace(/\/$/, "") : "" };
}

export function isUnauthorized(response) {
  return response?.status === 401;
}

export function createApi(config = dashboardConfig()) {
  return async function api(path, options) {
    const response = await fetch(`${config.apiBase}${path}`, {
      credentials: "same-origin",
      ...options,
      headers: { Accept: "application/json", ...(options?.headers ?? {}) },
    });
    if (isUnauthorized(response)) {
      window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      throw new Error("DASHBOARD_AUTH_REQUIRED");
    }
    return response;
  };
}
