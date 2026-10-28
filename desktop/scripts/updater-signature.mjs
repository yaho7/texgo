import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
// Tauri/minisign ED signatures: Ed25519 over a BLAKE2b-512 digest, plus a
// second Ed25519 signature authenticating the trusted (version-bound) comment.
export function verifyTauriDigest(digest, signature, pubkey, version) {
  const keyLines = Buffer.from(pubkey, 'base64').toString('utf8').trim().split(/\r?\n/);
  const lines = Buffer.from(signature.trim(), 'base64').toString('utf8').trim().split(/\r?\n/);
  if (lines.length !== 4 || !lines[2].startsWith('trusted comment: ')) throw new Error('Invalid updater signature');
  const key = Buffer.from(keyLines[1] ?? '', 'base64');
  const packet = Buffer.from(lines[1], 'base64');
  const global = Buffer.from(lines[3], 'base64');
  if (key.length !== 42 || packet.length !== 74 || global.length !== 64 || packet.subarray(0,2).toString() !== 'ED' || !key.subarray(2,10).equals(packet.subarray(2,10))) throw new Error('Invalid updater key or signature');
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100','hex'), key.subarray(10)]), format:'der', type:'spki' });
  const comment = lines[2].slice('trusted comment: '.length);
  const signedVersions = comment.split('\t').filter(field => field.startsWith('version:'));
  if (signedVersions.length !== 1 || signedVersions[0] !== `version:${version}`) throw new Error('Updater signature version mismatch');
  if (!verify(null, digest, publicKey, packet.subarray(10)) || !verify(null, Buffer.concat([packet.subarray(10), Buffer.from(comment)]), publicKey, global)) throw new Error('Updater signature verification failed');
}
export async function verifyTauriFile(file, signature, pubkey, version) {
  const hash = createHash('blake2b512');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  verifyTauriDigest(hash.digest(), signature, pubkey, version);
}
