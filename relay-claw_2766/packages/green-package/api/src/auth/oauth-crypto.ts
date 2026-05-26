import { createHash, randomBytes, webcrypto } from 'node:crypto';

export type DpopJwk = {
  kty?: string;
  x?: string;
  y?: string;
  crv?: string;
  d?: string;
};

function base64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64url');
}

export function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(randomBytes(32));
  const hash = createHash('sha256').update(codeVerifier).digest();
  return { codeVerifier, codeChallenge: base64url(hash) };
}

export function generateState(): string {
  return randomBytes(16).toString('hex');
}

export async function generateDpopKeyPair(): Promise<{
  privateJwk: DpopJwk;
  publicJwk: DpopJwk;
}> {
  const keyPair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicJwk = (await webcrypto.subtle.exportKey('jwk', keyPair.publicKey)) as DpopJwk;
  const privateJwk = (await webcrypto.subtle.exportKey('jwk', keyPair.privateKey)) as DpopJwk;
  return { privateJwk, publicJwk };
}

export async function importDpopPrivateKey(privateJwk: DpopJwk): Promise<webcrypto.CryptoKey> {
  return webcrypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export async function generateDpopJwt(
  privateKey: webcrypto.CryptoKey,
  publicJwk: DpopJwk,
  htm: string,
  htu: string,
): Promise<string> {
  const header = {
    typ: 'dpop+jwt',
    alg: 'ES256',
    jwk: { kty: publicJwk.kty, x: publicJwk.x, y: publicJwk.y, crv: publicJwk.crv },
  };
  const payload = {
    htm,
    htu,
    iat: Math.floor(Date.now() / 1000),
    jti: randomBytes(16).toString('hex'),
  };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    Buffer.from(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}
