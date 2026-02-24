"use strict";

/**
 * Encryption helper tests.
 * Run: MFA_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") node helpers/encryption.test.js
 */

const { encrypt, decrypt } = require("./encryption");

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}:`, err.message);
    process.exitCode = 1;
  }
}

test("encrypt and decrypt roundtrip", () => {
  const plain = "JBSWY3DPEHPK3PXP";
  const enc = encrypt(plain);
  if (typeof enc !== "string" || !enc.includes(":")) throw new Error("Invalid encrypt output");
  const dec = decrypt(enc);
  if (dec !== plain) throw new Error(`Expected "${plain}", got "${dec}"`);
});

test("encrypt produces different ciphertext each time", () => {
  const plain = "secret";
  const a = encrypt(plain);
  const b = encrypt(plain);
  if (a === b) throw new Error("Same plaintext should produce different ciphertext (random IV)");
  if (decrypt(a) !== plain || decrypt(b) !== plain) throw new Error("Both should decrypt correctly");
});

test("decrypt invalid format throws", () => {
  try {
    decrypt("invalid");
    throw new Error("Should have thrown");
  } catch (e) {
    if (!e.message.includes("Invalid")) throw e;
  }
});
