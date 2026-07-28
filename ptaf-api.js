const API_PATH = "/api/ptaf/v4";
const DEFAULT_FINGERPRINT = "212fa142fd787bf2e9fd3fb13872d2be";

export class PtafApiError extends Error {
  constructor(message, { status = null, responseBody = null, url = null } = {}) {
    super(message);
    this.name = "PtafApiError";
    this.status = status;
    this.responseBody = responseBody;
    this.url = url;
  }
}

export function buildApiBaseUrl(mgmtVipOrBaseUrl) {
  const raw = String(mgmtVipOrBaseUrl || "").trim();
  if (!raw) throw new Error("MGMT VIP or base URL is required.");

  let value = raw;
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  value = value.replace(/\/+$/, "");
  if (/\/api\/ptaf\/v4$/i.test(value)) {
    return value;
  }
  return `${value}${API_PATH}`;
}

async function readJsonOrText(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

async function fetchJson(url, { method = "GET", headers = {}, body = undefined } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const responseBody = await readJsonOrText(response);

  if (!response.ok) {
    const serverMessage = typeof responseBody === "string"
      ? responseBody
      : responseBody?.message || responseBody?.error || JSON.stringify(responseBody);
    throw new PtafApiError(
      `PTAF API request failed: ${response.status} ${response.statusText}${serverMessage ? ` - ${serverMessage}` : ""}`,
      {
        status: response.status,
        responseBody,
        url
      }
    );
  }

  return responseBody;
}

function extractSingleTenantId(tokenResponse) {
  if (!tokenResponse || typeof tokenResponse !== "object") return null;

  if (typeof tokenResponse.tenant_id === "string") return tokenResponse.tenant_id;
  if (typeof tokenResponse.tenantId === "string") return tokenResponse.tenantId;
  if (tokenResponse.tenant && typeof tokenResponse.tenant.id === "string") return tokenResponse.tenant.id;

  const possibleLists = [tokenResponse.tenants, tokenResponse.items, tokenResponse.available_tenants]
    .filter(Array.isArray);

  for (const list of possibleLists) {
    if (list.length === 1 && typeof list[0]?.id === "string") return list[0].id;
    if (list.length === 1 && typeof list[0]?.tenant_id === "string") return list[0].tenant_id;
  }

  return null;
}

export class PtafApiClient {
  constructor({ mgmtVip, username, password }) {
    this.apiBaseUrl = buildApiBaseUrl(mgmtVip);
    this.username = username;
    this.password = password;
    this.fingerprint = DEFAULT_FINGERPRINT;
    this.accessToken = null;
  }

  async authenticate() {
    const tokens = await fetchJson(`${this.apiBaseUrl}/auth/refresh_tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: {
        username: this.username,
        password: this.password,
        fingerprint: this.fingerprint
      }
    });

    if (tokens?.access_token) {
      this.accessToken = tokens.access_token;
      return this.accessToken;
    }

    const tenantId = extractSingleTenantId(tokens);
    if (tokens?.refresh_token && tenantId) {
      const authorized = await fetchJson(`${this.apiBaseUrl}/auth/access_tokens`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: {
          refresh_token: tokens.refresh_token,
          fingerprint: this.fingerprint,
          tenant_id: tenantId
        }
      });

      if (authorized?.access_token) {
        this.accessToken = authorized.access_token;
        return this.accessToken;
      }
    }

    const keys = Object.keys(tokens || {}).join(", ");
    throw new PtafApiError(
      `Authentication succeeded but no access_token was found. Response keys: ${keys || "none"}.`,
      { responseBody: tokens }
    );
  }

  async request(path, { method = "GET", body = undefined } = {}) {
    if (!this.accessToken) await this.authenticate();

    return fetchJson(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json"
      },
      body
    });
  }

  async getTrafficSettings() {
    return this.request("/config/traffic_settings/", { method: "GET" });
  }

  async updateTrafficSettings(configurations) {
    return this.request("/config/traffic_settings/", {
      method: "PATCH",
      body: configurations
    });
  }
}
