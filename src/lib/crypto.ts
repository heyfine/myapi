import crypto from "node:crypto";

// ---- 主密钥（加密渠道上游 API Key 用） ----
function masterKey(): Buffer {
  const secret = process.env.GATEWAY_SECRET || "dev-insecure-secret-change-me";
  // 派生 32 字节密钥
  return crypto.createHash("sha256").update(secret).digest();
}

/** AES-256-GCM 加密，输出 base64(iv|tag|ciphertext) */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// ---- 用户密码：scrypt ----
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

// ---- 网关令牌 sk-xxx：只存哈希 ----
export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function generateTokenKey(): { key: string; hash: string; prefix: string } {
  const key = "sk-" + crypto.randomBytes(24).toString("hex");
  return { key, hash: sha256(key), prefix: key.slice(0, 11) };
}
