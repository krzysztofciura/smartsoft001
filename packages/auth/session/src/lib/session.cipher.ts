import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Envelope encryption of one stored session: a fresh 256-bit data key per
 * write (AES-256-GCM), wrapped by the configured key. The additional data
 * binds the envelope to its table and row, so a copied envelope does not open.
 * Format: `{"v":1,"kid","key","data"}` (base64 IV ‖ ciphertext ‖ tag).
 */
export class SessionCipher {
  constructor(
    private readonly masterKey: Buffer,
    private readonly keyId = 'v1',
    private readonly maxEnvelope = 32768,
  ) {
    if (
      !Buffer.isBuffer(masterKey) ||
      masterKey.length !== 32 ||
      !/^[a-zA-Z0-9_-]{1,32}$/.test(keyId)
    )
      throw new Error('Invalid session key');
  }

  seal(plaintext: string, table: string, rowId: string): string {
    const context = JSON.stringify(['shop-row', 1, this.keyId, table, rowId]);
    const key = randomBytes(32);
    try {
      return JSON.stringify({
        v: 1,
        kid: this.keyId,
        key: this.encrypt(this.masterKey, key, context + ':key'),
        data: this.encrypt(key, Buffer.from(plaintext), context + ':data'),
      });
    } finally {
      key.fill(0);
    }
  }

  open(envelope: string, table: string, rowId: string): string {
    if (envelope.length > this.maxEnvelope) throw new Error('Invalid envelope');
    const value = JSON.parse(envelope) as {
      v: number;
      kid: string;
      key: string;
      data: string;
    };
    if (
      value.v !== 1 ||
      value.kid !== this.keyId ||
      typeof value.key !== 'string' ||
      typeof value.data !== 'string'
    )
      throw new Error('Unsupported envelope');
    const context = JSON.stringify(['shop-row', 1, value.kid, table, rowId]);
    const key = this.decrypt(this.masterKey, value.key, context + ':key');
    try {
      return this.decrypt(key, value.data, context + ':data').toString();
    } finally {
      key.fill(0);
    }
  }

  private encrypt(key: Buffer, plaintext: Buffer, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context));
    return Buffer.concat([
      iv,
      cipher.update(plaintext),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64');
  }

  private decrypt(key: Buffer, envelope: string, context: string): Buffer {
    const data = Buffer.from(envelope, 'base64');
    if (data.length < 28) throw new Error('Invalid envelope');
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(data.subarray(-16));
    return Buffer.concat([
      decipher.update(data.subarray(12, -16)),
      decipher.final(),
    ]);
  }
}
