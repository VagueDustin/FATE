// The committed public keyring (build/linux/fate-archive-keyring.{gpg,asc}) is what every .deb and
// .rpm ships and every apt/dnf install trusts. The Build Linux workflow signs only with the keys
// listed in its SIGNING_KEYS. These tests read the OpenPGP packets directly (no gpg needed) and
// check that the two files hold the same keys and that every signing key is among them, so a
// release can never be signed with a key the packages don't carry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keyringPath = (ext) => join(root, 'build', 'linux', `fate-archive-keyring.${ext}`);

function dearmor(text) {
  const body = text.match(/-----BEGIN PGP PUBLIC KEY BLOCK-----\r?\n([\s\S]*?)-----END PGP PUBLIC KEY BLOCK-----/);
  assert.ok(body, 'not an armored public key block');
  // Drop the armor headers (up to the first blank line, if any) and the "=XXXX" CRC line.
  const lines = body[1].split(/\r?\n/);
  const blank = lines.indexOf('');
  const data = (blank === -1 ? lines : lines.slice(blank + 1)).filter((l) => l && !l.startsWith('='));
  return Buffer.from(data.join(''), 'base64');
}

/** Fingerprints (v4: SHA-1 of 0x99, length, body) of the primary keys (packet tag 6). */
function primaryFingerprints(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const ctb = buf[i];
    assert.ok(ctb & 0x80, `bad packet header at ${i}`);
    let tag;
    let len;
    let start;
    if (ctb & 0x40) {
      tag = ctb & 0x3f;
      const o = buf[i + 1];
      if (o < 192) { len = o; start = i + 2; }
      else if (o < 224) { len = ((o - 192) << 8) + buf[i + 2] + 192; start = i + 3; }
      else if (o === 255) { len = buf.readUInt32BE(i + 2); start = i + 6; }
      else throw new Error('partial body lengths are not used in key packets');
    } else {
      tag = (ctb >> 2) & 0x0f;
      const type = ctb & 3;
      if (type === 0) { len = buf[i + 1]; start = i + 2; }
      else if (type === 1) { len = buf.readUInt16BE(i + 1); start = i + 3; }
      else if (type === 2) { len = buf.readUInt32BE(i + 1); start = i + 5; }
      else throw new Error('indeterminate length');
    }
    const body = buf.subarray(start, start + len);
    if (tag === 6) {
      assert.equal(body[0], 4, 'only v4 keys are expected');
      const head = Buffer.from([0x99, (len >> 8) & 0xff, len & 0xff]);
      out.push(createHash('sha1').update(head).update(body).digest('hex').toUpperCase());
    }
    i = start + len;
  }
  return out;
}

const binary = primaryFingerprints(readFileSync(keyringPath('gpg')));
const armored = primaryFingerprints(dearmor(readFileSync(keyringPath('asc'), 'utf8')));

const workflow = readFileSync(join(root, '.github', 'workflows', 'build-linux.yml'), 'utf8');
const signingKeys = (workflow.match(/^\s*SIGNING_KEYS:\s*['"]?([0-9A-F ]+?)['"]?\s*$/m)?.[1] ?? '').split(/\s+/).filter(Boolean);

test('the .gpg and .asc keyrings hold the same keys', () => {
  assert.ok(binary.length >= 1);
  assert.deepEqual([...binary].sort(), [...armored].sort());
});

test('Build Linux names its signing keys by full fingerprint', () => {
  assert.ok(signingKeys.length >= 1, 'SIGNING_KEYS missing from build-linux.yml');
  for (const fpr of signingKeys) assert.match(fpr, /^[0-9A-F]{40}$/);
});

test('every signing key is in the keyring the packages ship', () => {
  for (const fpr of signingKeys) assert.ok(binary.includes(fpr), `${fpr} is not in build/linux/fate-archive-keyring.gpg`);
});
