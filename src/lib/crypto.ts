import type { EncryptedPayload } from "../types/api";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const rsaAlgorithm: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

const aesKwAlgorithm = { name: "AES-KW", length: 256 };

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export async function generateRSAKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(rsaAlgorithm, true, ["encrypt", "decrypt"]);
}

export async function exportPublicKeyBase64(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  return arrayBufferToBase64(spki);
}

export async function importPublicKeyBase64(publicKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", base64ToArrayBuffer(publicKey), { name: "RSA-OAEP", hash: "SHA-256" }, true, [
    "encrypt",
  ]);
}

export function generatePBKDF2Salt(): string {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return arrayBufferToBase64(salt.buffer);
}

export async function deriveWrappingKey(password: string, saltBase64: string): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToArrayBuffer(saltBase64),
      iterations: 250_000,
      hash: "SHA-256",
    },
    passwordKey,
    aesKwAlgorithm,
    false,
    ["wrapKey", "unwrapKey"],
  );
}

export async function wrapPrivateKey(privateKey: CryptoKey, wrappingKey: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
  const paddedPrivateKey = await importPaddedPrivateKeyBytes(addAesKwPadding(pkcs8));
  const wrapped = await crypto.subtle.wrapKey("raw", paddedPrivateKey, wrappingKey, "AES-KW");
  return arrayBufferToBase64(wrapped);
}

export async function unwrapPrivateKey(wrappedPrivateKey: string, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const paddedPrivateKey = await crypto.subtle.unwrapKey(
    "raw",
    base64ToArrayBuffer(wrappedPrivateKey),
    wrappingKey,
    "AES-KW",
    { name: "HMAC", hash: "SHA-256" },
    true,
    ["sign"],
  );
  const paddedPkcs8 = await crypto.subtle.exportKey("raw", paddedPrivateKey);

  return crypto.subtle.importKey(
    "pkcs8",
    removeAesKwPadding(paddedPkcs8),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
}

async function importPaddedPrivateKeyBytes(bytes: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, true, ["sign"]);
}

function addAesKwPadding(buffer: ArrayBuffer): ArrayBuffer {
  const source = new Uint8Array(buffer);
  const totalLength = 4 + source.byteLength;
  const paddedLength = Math.ceil(totalLength / 8) * 8;
  const padded = new Uint8Array(paddedLength);
  const view = new DataView(padded.buffer);
  view.setUint32(0, source.byteLength, false);
  padded.set(source, 4);
  return padded.buffer;
}

function removeAesKwPadding(buffer: ArrayBuffer): ArrayBuffer {
  const padded = new Uint8Array(buffer);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  const originalLength = view.getUint32(0, false);
  if (originalLength <= 0 || originalLength > padded.byteLength - 4) {
    throw new Error("Invalid wrapped private key padding.");
  }
  return padded.slice(4, 4 + originalLength).buffer;
}

export async function generateAESGCMKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function encryptMessage(plaintext: string, aesKey?: CryptoKey): Promise<{
  ciphertext: string;
  iv: string;
  key: CryptoKey;
}> {
  const key = aesKey ?? (await generateAESGCMKey());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, textEncoder.encode(plaintext));

  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv.buffer),
    key,
  };
}

export async function decryptMessage(ciphertext: string, iv: string, aesKey: CryptoKey): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToArrayBuffer(iv) },
    aesKey,
    base64ToArrayBuffer(ciphertext),
  );
  return textDecoder.decode(plaintext);
}

export async function encryptAESKeyForUser(aesKey: CryptoKey, userPublicKey: CryptoKey): Promise<string> {
  const rawKey = await crypto.subtle.exportKey("raw", aesKey);
  const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, userPublicKey, rawKey);
  return arrayBufferToBase64(encrypted);
}

export async function decryptAESKey(encryptedKey: string, privateKey: CryptoKey): Promise<CryptoKey> {
  const rawKey = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, base64ToArrayBuffer(encryptedKey));
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function buildEncryptedPayload(
  plaintext: string,
  recipientPublicKeyBase64: string,
  senderPublicKeyBase64: string,
): Promise<EncryptedPayload> {
  const recipientPublicKey = await importPublicKeyBase64(recipientPublicKeyBase64);
  const senderPublicKey = await importPublicKeyBase64(senderPublicKeyBase64);
  const encrypted = await encryptMessage(plaintext);

  return {
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    encryptedKey: await encryptAESKeyForUser(encrypted.key, recipientPublicKey),
    encryptedKeyForSelf: await encryptAESKeyForUser(encrypted.key, senderPublicKey),
  };
}
