import { createHmac } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";

type SharedSchedulePayload = {
  name: string;
  courses: unknown[];
  generatedAt: string;
};

function base64UrlEncode(value: string): string {
  const compressed = brotliCompressSync(Buffer.from(value, "utf-8"));
  return compressed.toString("base64url");
}

function base64UrlDecode(value: string): string {
  const compressed = Buffer.from(value, "base64url");
  return brotliDecompressSync(compressed).toString("utf-8");
}

function getShareSecret() {
  return process.env.SHARE_LINK_SECRET || process.env.NEXTAUTH_SECRET || "dev-share-secret";
}

function signPayload(payloadB64: string): string {
  return createHmac("sha256", getShareSecret()).update(payloadB64).digest("base64url");
}

export function createSignedSharePayload(payload: SharedSchedulePayload): { payload: string; sig: string } {
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  return { payload: payloadB64, sig: signPayload(payloadB64) };
}

export function createSignedShareToken(payload: SharedSchedulePayload): string {
  const signed = createSignedSharePayload(payload);
  return `${signed.payload}.${signed.sig}`;
}

export function verifySignedSharePayload(payloadB64: string, sig: string): SharedSchedulePayload | null {
  if (!payloadB64 || !sig) return null;
  const expected = signPayload(payloadB64);
  if (expected !== sig) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(payloadB64)) as SharedSchedulePayload;
    if (!parsed || typeof parsed.name !== "string" || !Array.isArray(parsed.courses)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function verifySignedShareToken(token: string): SharedSchedulePayload | null {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return null;
  return verifySignedSharePayload(payload, sig);
}
