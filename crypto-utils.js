const DB_NAME = "ptaf-native-secrets";
const DB_VERSION = 1;
const KEY_STORE = "cryptoKeys";
const PASSWORD_KEY_ID = "ptaf-password-key";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function openSecretsDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open IndexedDB."));
  });
}

async function idbGet(storeName, key) {
  const db = await openSecretsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Could not read IndexedDB value."));
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB transaction failed."));
    };
  });
}

async function idbSet(storeName, key, value) {
  const db = await openSecretsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.put(value, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("Could not write IndexedDB value."));
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB transaction failed."));
    };
  });
}

async function idbDelete(storeName, key) {
  const db = await openSecretsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("Could not delete IndexedDB value."));
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB transaction failed."));
    };
  });
}

async function generatePasswordKey() {
  return crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

async function getOrCreatePasswordKey() {
  const savedKey = await idbGet(KEY_STORE, PASSWORD_KEY_ID);
  if (savedKey) return savedKey;

  const key = await generatePasswordKey();
  await idbSet(KEY_STORE, PASSWORD_KEY_ID, key);
  return key;
}

export async function encryptString(plainText) {
  const key = await getOrCreatePasswordKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv
    },
    key,
    encoder.encode(plainText)
  );

  return {
    version: 2,
    algorithm: "AES-GCM",
    keyStorage: "IndexedDB non-extractable CryptoKey",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer))
  };
}

export async function decryptString(encryptedPayload) {
  if (!encryptedPayload || encryptedPayload.version !== 2) {
    throw new Error("Пароль сохранён в старом формате с master password. Сохрани профиль заново и введи PTAF password один раз.");
  }

  const key = await getOrCreatePasswordKey();
  const iv = base64ToBytes(encryptedPayload.iv);
  const ciphertext = base64ToBytes(encryptedPayload.ciphertext);

  try {
    const plainBuffer = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv
      },
      key,
      ciphertext
    );
    return decoder.decode(plainBuffer);
  } catch (_error) {
    throw new Error("Не удалось расшифровать пароль. Возможно, был удалён локальный ключ браузера. Сохрани профиль заново.");
  }
}

export async function deleteNativePasswordKey() {
  await idbDelete(KEY_STORE, PASSWORD_KEY_ID);
}
