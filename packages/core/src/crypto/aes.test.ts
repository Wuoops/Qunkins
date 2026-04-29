import { encrypt, decrypt } from './aes';

describe('AES Encryption', () => {
  const secret = 'test-secret-key-32bytes!';
  const plaintext = 'sensitive-data';

  it('should encrypt and decrypt correctly', () => {
    const encrypted = encrypt(plaintext, secret);
    expect(encrypted).not.toBe(plaintext);
    
    const decrypted = decrypt(encrypted, secret);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext each time', () => {
    const encrypted1 = encrypt(plaintext, secret);
    const encrypted2 = encrypt(plaintext, secret);
    expect(encrypted1).not.toBe(encrypted2);
  });

  it('should fail with wrong secret', () => {
    const encrypted = encrypt(plaintext, secret);
    expect(() => decrypt(encrypted, 'wrong-secret')).toThrow();
  });
});
