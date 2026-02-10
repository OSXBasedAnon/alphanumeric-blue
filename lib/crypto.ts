import nacl from "tweetnacl";

export function decodeHex(input: string): Uint8Array {
  const clean = input.startsWith("0x") ? input.slice(2) : input;
  if (clean.length % 2 !== 0) throw new Error("Invalid hex length");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

export function decodeBase64(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const b64 = normalized + pad;
  const binary = Buffer.from(b64, "base64");
  return new Uint8Array(binary);
}

export function decodeKey(input: string): Uint8Array {
  if (/^[0-9a-fA-F]+$/.test(input.replace(/^0x/, ""))) {
    return decodeHex(input);
  }
  return decodeBase64(input);
}

export function verifyEd25519(message: string, signature: string, publicKey: string): boolean {
  const msgBytes = new TextEncoder().encode(message);
  const sigBytes = decodeKey(signature);
  const pubBytes = decodeKey(publicKey);
  if (sigBytes.length !== 64) return false;
  if (pubBytes.length !== 32) return false;
  return nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes);
}
