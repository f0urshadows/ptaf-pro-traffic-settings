import { deleteNativePasswordKey, encryptString } from "./crypto-utils.js";

const PROFILE_KEY = "ptafProfile";
const LOG_KEY = "ptafUiLog";
const LAST_PATCH_KEY = "ptafLastSuccessfulPatch";
const FIXED_FINGERPRINT = "212fa142fd787bf2e9fd3fb13872d2be";
const MAX_LOG_ITEMS = 30;

const els = {
  authDetails: document.querySelector("#authDetails"),
  profileSummary: document.querySelector("#profileSummary"),
  lastPatchStatus: document.querySelector("#lastPatchStatus"),
  settingsCount: document.querySelector("#settingsCount"),
  mgmtVip: document.querySelector("#mgmtVip"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  saveProfile: document.querySelector("#saveProfile"),
  testConnection: document.querySelector("#testConnection"),
  clearProfile: document.querySelector("#clearProfile"),
  getSettings: document.querySelector("#getSettings"),
  patchSettings: document.querySelector("#patchSettings"),
  copyJson: document.querySelector("#copyJson"),
  filterSettings: document.querySelector("#filterSettings"),
  settingsEditor: document.querySelector("#settingsEditor"),
  patchJson: document.querySelector("#patchJson"),
  output: document.querySelector("#output"),
  profileHint: document.querySelector("#profileHint")
};

let currentSettingsKeys = [];
let originalSettings = null;
let eventLog = [];
let lastResult = "Готово к работе.";

function formatDateTime(value = new Date()) {
  return new Date(value).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function stringifyForDisplay(value) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function renderOutput() {
  const logText = eventLog.length
    ? eventLog.map((item) => `[${formatDateTime(item.at)}] ${item.level}: ${item.message}`).join("\n")
    : "Лог пока пуст.";

  els.output.textContent = `${logText}\n\n--- Последний результат ---\n${lastResult}`;
}

function setOutput(value) {
  lastResult = stringifyForDisplay(value);
  renderOutput();
}

async function addLog(message, { level = "INFO", details = null } = {}) {
  const entry = {
    at: new Date().toISOString(),
    level,
    message,
    details
  };

  eventLog = [entry, ...eventLog].slice(0, MAX_LOG_ITEMS);
  await chromeSet({ [LOG_KEY]: eventLog });
  renderOutput();
}

function requireValue(element, label) {
  const value = element.value.trim();
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function setBusy(isBusy) {
  for (const button of document.querySelectorAll("button")) {
    button.disabled = isBusy;
  }
}

async function chromeGet(key) {
  return chrome.storage.local.get(key);
}

async function chromeSet(object) {
  return chrome.storage.local.set(object);
}

async function chromeRemove(key) {
  return chrome.storage.local.remove(key);
}

async function sendRuntimeMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    const error = response?.error || { message: "Unknown extension error." };
    throw new Error(error.message || JSON.stringify(error));
  }
  return response.data;
}

function getValueKind(value) {
  if (value === null) return "json";
  if (Array.isArray(value)) return "json";
  if (typeof value === "object") return "json";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "string";
}

function getTypeLabel(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function createControlForValue(key, value, kind) {
  const wrap = document.createElement("div");
  wrap.className = "setting-control-wrap";

  if (kind === "boolean") {
    const wrapper = document.createElement("label");
    wrapper.className = "checkbox-line";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(value);
    input.dataset.role = "setting-control";
    const text = document.createElement("span");
    text.textContent = value ? "true" : "false";
    input.addEventListener("change", () => {
      text.textContent = input.checked ? "true" : "false";
    });
    wrapper.append(input, text);
    wrap.append(wrapper);
    return wrap;
  }

  if (kind === "number") {
    const input = document.createElement("input");
    input.type = "number";
    input.step = "any";
    input.value = String(value);
    input.dataset.role = "setting-control";
    wrap.append(input);
    return wrap;
  }

  if (kind === "json") {
    const textarea = document.createElement("textarea");
    textarea.className = "json-value";
    textarea.spellcheck = false;
    textarea.value = JSON.stringify(value, null, 2);
    textarea.dataset.role = "setting-control";
    wrap.append(textarea);
    return wrap;
  }

  const input = String(value).length > 110 ? document.createElement("textarea") : document.createElement("input");
  if (input.tagName === "TEXTAREA") {
    input.className = "string-value";
    input.spellcheck = false;
  } else {
    input.type = "text";
  }
  input.value = value ?? "";
  input.dataset.role = "setting-control";
  wrap.append(input);
  return wrap;
}

function createFieldForValue(key, value) {
  const row = document.createElement("div");
  row.className = "setting-row";
  row.dataset.key = key;
  row.dataset.search = key.toLowerCase();
  row.dataset.kind = getValueKind(value);

  const top = document.createElement("div");
  top.className = "setting-top";

  const name = document.createElement("p");
  name.className = "setting-name";
  name.textContent = key;

  const type = document.createElement("span");
  type.className = "type-badge";
  type.textContent = getTypeLabel(value);

  top.append(name, type);
  row.append(top, createControlForValue(key, value, row.dataset.kind));
  return row;
}

function updateSettingsCount() {
  if (!currentSettingsKeys.length) {
    els.settingsCount.textContent = "0 параметров";
    return;
  }

  const visible = Array.from(els.settingsEditor.querySelectorAll(".setting-row")).filter((row) => !row.hidden).length;
  els.settingsCount.textContent = visible === currentSettingsKeys.length
    ? `${currentSettingsKeys.length} параметров`
    : `${visible} из ${currentSettingsKeys.length}`;
}

function renderSettingsEditor(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Traffic settings response must be a JSON object.");
  }

  originalSettings = structuredClone(settings);
  currentSettingsKeys = Object.keys(settings);
  els.settingsEditor.textContent = "";
  els.settingsEditor.classList.remove("empty");

  const fragment = document.createDocumentFragment();
  for (const key of currentSettingsKeys) {
    fragment.append(createFieldForValue(key, settings[key]));
  }
  els.settingsEditor.append(fragment);
  applySettingsFilter();
}

function buildSettingsFromEditor() {
  if (!currentSettingsKeys.length) {
    try {
      return JSON.parse(els.patchJson.value);
    } catch (_error) {
      throw new Error("Форма не загружена, а Raw JSON некорректен.");
    }
  }

  const result = {};
  for (const key of currentSettingsKeys) {
    const row = els.settingsEditor.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!row) continue;

    const kind = row.dataset.kind;
    const control = row.querySelector("[data-role='setting-control']");

    if (kind === "boolean") {
      result[key] = control.checked;
      continue;
    }

    if (kind === "number") {
      const value = Number(control.value);
      if (Number.isNaN(value)) throw new Error(`Параметр ${key}: нужно число.`);
      result[key] = value;
      continue;
    }

    if (kind === "json") {
      try {
        result[key] = JSON.parse(control.value);
      } catch (_error) {
        throw new Error(`Параметр ${key}: значение должно быть валидным JSON.`);
      }
      continue;
    }

    result[key] = control.value;
  }

  return result;
}

function valueToComparable(value) {
  return JSON.stringify(value);
}

function getChangedKeys(nextSettings) {
  if (!originalSettings) return Object.keys(nextSettings);

  return Object.keys(nextSettings).filter((key) => (
    valueToComparable(originalSettings[key]) !== valueToComparable(nextSettings[key])
  ));
}

function applySettingsFilter() {
  const query = els.filterSettings.value.trim().toLowerCase();
  for (const row of els.settingsEditor.querySelectorAll(".setting-row")) {
    row.hidden = Boolean(query) && !row.dataset.search.includes(query);
  }
  updateSettingsCount();
}

function renderLastPatch(lastPatch) {
  if (!lastPatch?.at) {
    els.lastPatchStatus.textContent = "Последний успешный PATCH: нет данных.";
    return;
  }

  const changedPart = Number.isFinite(lastPatch.changedCount)
    ? `, изменено параметров: ${lastPatch.changedCount}`
    : "";
  els.lastPatchStatus.textContent = `Последний успешный PATCH: ${formatDateTime(lastPatch.at)}${changedPart}.`;
}

async function loadRuntimeState() {
  const data = await chrome.storage.local.get([LOG_KEY, LAST_PATCH_KEY]);
  eventLog = Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
  renderLastPatch(data[LAST_PATCH_KEY]);
  renderOutput();
}

async function loadProfile() {
  const { [PROFILE_KEY]: profile } = await chromeGet(PROFILE_KEY);

  if (!profile) {
    els.profileHint.textContent = "Профиль подключения ещё не сохранён.";
    els.profileSummary.textContent = "не настроено";
    els.authDetails.open = true;
    return;
  }

  els.mgmtVip.value = profile.mgmtVip || "";
  els.username.value = profile.username || "";

  const isNativeEncryption = profile.encryptedPassword?.version === 2;
  const encryption = isNativeEncryption ? "native Web Crypto key" : "старый master-password формат";
  els.profileSummary.textContent = `настроено: ${profile.username || "user"} @ ${profile.mgmtVip || "host"}`;
  els.profileHint.textContent = `Профиль сохранён: ${formatDateTime(profile.updatedAt)}. Шифрование: ${encryption}.`;
  els.authDetails.open = !isNativeEncryption;
}

async function saveProfile() {
  const mgmtVip = requireValue(els.mgmtVip, "MGMT VIP / Base URL");
  const username = requireValue(els.username, "Username");
  const password = els.password.value;

  const { [PROFILE_KEY]: existingProfile } = await chromeGet(PROFILE_KEY);
  let encryptedPassword = existingProfile?.encryptedPassword || null;

  if (password) {
    encryptedPassword = await encryptString(password);
  }

  if (!encryptedPassword) {
    throw new Error("PTAF password is required for the first save.");
  }

  const profile = {
    mgmtVip,
    username,
    fingerprint: FIXED_FINGERPRINT,
    encryptedPassword,
    updatedAt: new Date().toISOString()
  };

  await chromeSet({ [PROFILE_KEY]: profile });
  els.password.value = "";
  await loadProfile();
  els.authDetails.open = false;
  await addLog("Профиль подключения сохранён.");
  setOutput("Профиль сохранён. Пароль PTAF зашифрован локальным ключом браузера, master password не нужен.");
}

async function testConnection() {
  const data = await sendRuntimeMessage({ type: "TEST_CONNECTION" });
  await addLog("Аутентификация прошла успешно.");
  setOutput(data);
}

async function getSettings() {
  const data = await sendRuntimeMessage({ type: "GET_TRAFFIC_SETTINGS" });
  renderSettingsEditor(data);
  els.patchJson.value = JSON.stringify(data, null, 2);
  await addLog(`GET settings выполнен успешно, получено параметров: ${Object.keys(data).length}.`);
  setOutput({ loaded: true, parameters: Object.keys(data).length });
}

async function patchSettings() {
  const configurations = buildSettingsFromEditor();
  const changedKeys = getChangedKeys(configurations);
  els.patchJson.value = JSON.stringify(configurations, null, 2);

  const changeText = changedKeys.length
    ? `Изменённых параметров относительно последнего GET: ${changedKeys.length}.`
    : "Отличий относительно последнего GET не найдено, но PATCH всё равно будет отправлен.";

  const approved = window.confirm(`${changeText}\n\nОтправить PATCH /config/traffic_settings/ со значениями из формы?`);
  if (!approved) return;

  const data = await sendRuntimeMessage({
    type: "PATCH_TRAFFIC_SETTINGS",
    configurations
  });

  const lastPatch = {
    at: new Date().toISOString(),
    changedCount: changedKeys.length,
    changedKeys: changedKeys.slice(0, 50)
  };
  await chromeSet({ [LAST_PATCH_KEY]: lastPatch });
  renderLastPatch(lastPatch);
  originalSettings = structuredClone(configurations);

  const changedPreview = changedKeys.length
    ? ` Изменённые параметры: ${changedKeys.slice(0, 8).join(", ")}${changedKeys.length > 8 ? ", ..." : ""}.`
    : "";
  await addLog(`PATCH успешно применён.${changedPreview}`);

  setOutput({
    patched: true,
    patchedAt: formatDateTime(lastPatch.at),
    changedCount: changedKeys.length,
    changedKeys,
    response: data ?? "Сервер вернул пустой ответ."
  });
}

async function copyJsonFromForm() {
  const configurations = buildSettingsFromEditor();
  const json = JSON.stringify(configurations, null, 2);
  els.patchJson.value = json;
  await navigator.clipboard.writeText(json);
  await addLog("JSON из формы собран и скопирован в буфер обмена.");
  setOutput("JSON из формы собран и скопирован в буфер обмена.");
}

async function clearProfile() {
  const approved = window.confirm("Удалить сохранённый профиль подключения и локальный ключ шифрования?");
  if (!approved) return;

  await chromeRemove(PROFILE_KEY);
  await deleteNativePasswordKey();
  els.mgmtVip.value = "";
  els.username.value = "";
  els.password.value = "";
  els.profileHint.textContent = "Профиль и локальный ключ удалены.";
  els.profileSummary.textContent = "не настроено";
  els.authDetails.open = true;
  await addLog("Профиль подключения и локальный ключ удалены.", { level: "WARN" });
  setOutput("Профиль подключения удалён из chrome.storage.local, ключ шифрования удалён из IndexedDB.");
}

async function runSafely(action) {
  setBusy(true);
  try {
    await action();
  } catch (error) {
    const message = error.message || String(error);
    await addLog(`Ошибка: ${message}`, { level: "ERROR" });
    setOutput(`Ошибка: ${message}`);
  } finally {
    setBusy(false);
  }
}

els.saveProfile.addEventListener("click", () => runSafely(saveProfile));
els.testConnection.addEventListener("click", () => runSafely(testConnection));
els.getSettings.addEventListener("click", () => runSafely(getSettings));
els.patchSettings.addEventListener("click", () => runSafely(patchSettings));
els.copyJson.addEventListener("click", () => runSafely(copyJsonFromForm));
els.clearProfile.addEventListener("click", () => runSafely(clearProfile));
els.filterSettings.addEventListener("input", applySettingsFilter);

document.addEventListener("DOMContentLoaded", () => runSafely(async () => {
  await loadRuntimeState();
  await loadProfile();
}));
