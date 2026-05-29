import crypto from 'crypto';

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run admin:hash-password -- "your-password"');
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 32);
const encoded = `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
console.log(encoded);
