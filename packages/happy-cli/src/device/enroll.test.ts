import { describe, it, expect } from 'vitest';
import tweetnacl from 'tweetnacl';

/**
 * Locks the enrollment crypto contract between the app and the CLI.
 *
 * The app seals the account key with libsodium's `crypto_box_seed_keypair`,
 * which does NOT treat the token secret as a private key — it derives one via
 * SHA-512. The CLI must mirror that derivation; using the raw secret makes the
 * box fail to open with "could not open the account key with this token".
 */
describe('device enrollment key derivation', () => {
    it('derives the box secret key as SHA-512(seed)[0:32]', () => {
        const seed = tweetnacl.randomBytes(32);
        const derived = tweetnacl.hash(seed).slice(0, 32);

        // A box sealed to the derived public key opens with the derived key...
        const recipientPublic = tweetnacl.box.keyPair.fromSecretKey(derived).publicKey;
        const ephemeral = tweetnacl.box.keyPair();
        const nonce = tweetnacl.randomBytes(tweetnacl.box.nonceLength);
        const message = tweetnacl.randomBytes(32);
        const sealed = tweetnacl.box(message, nonce, recipientPublic, ephemeral.secretKey);

        const opened = tweetnacl.box.open(sealed, nonce, ephemeral.publicKey, derived);
        expect(opened).not.toBeNull();
        expect(Buffer.from(opened!)).toEqual(Buffer.from(message));

        // ...and not with the raw seed, which is the bug this guards against.
        const openedWithRawSeed = tweetnacl.box.open(sealed, nonce, ephemeral.publicKey, seed);
        expect(openedWithRawSeed).toBeNull();
    });
});
