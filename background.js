import { decryptString } from "./crypto-utils.js";
import { PtafApiClient, PtafApiError } from "./ptaf-api.js";

const PROFILE_KEY = "ptafProfile";

async function getProfileWithPassword() {
  const { [PROFILE_KEY]: profile } = await chrome.storage.local.get(PROFILE_KEY);
  if (!profile) {
    throw new Error("Connection profile is not saved yet.");
  }

  const password = await decryptString(profile.encryptedPassword);
  return {
    mgmtVip: profile.mgmtVip,
    username: profile.username,
    password
  };
}

function errorToPayload(error) {
  const payload = {
    message: error?.message || String(error)
  };

  if (error instanceof PtafApiError) {
    payload.status = error.status;
    payload.url = error.url;
    payload.responseBody = error.responseBody;
  }

  return payload;
}

async function handleMessage(message) {
  if (!message || typeof message !== "object") {
    throw new Error("Invalid extension message.");
  }

  switch (message.type) {
    case "GET_TRAFFIC_SETTINGS": {
      const profile = await getProfileWithPassword();
      const client = new PtafApiClient(profile);
      const data = await client.getTrafficSettings();
      return { data };
    }

    case "PATCH_TRAFFIC_SETTINGS": {
      const profile = await getProfileWithPassword();
      const client = new PtafApiClient(profile);
      const data = await client.updateTrafficSettings(message.configurations);
      return { data };
    }

    case "TEST_CONNECTION": {
      const profile = await getProfileWithPassword();
      const client = new PtafApiClient(profile);
      await client.authenticate();
      return {
        data: {
          authenticated: true,
          apiBaseUrl: client.apiBaseUrl,
          fingerprint: "212fa142fd787bf2e9fd3fb13872d2be"
        }
      };
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: errorToPayload(error) }));

  return true;
});
