// Certificat HTTPS auto-signé pour la démo sur réseau local (caméra et NFC exigent HTTPS sur téléphone).
//   npm run cert:lan        puis ajoutez au .env : HTTPS_KEY_PATH=certs/lan.key  HTTPS_CERT_PATH=certs/lan.crt
// Le téléphone ouvre https://<ip-du-pc>:8443 et accepte l'avertissement une fois.
import fs from 'node:fs';
import os from 'node:os';
import selfsigned from 'selfsigned';

const ips = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address);
const pems = await selfsigned.generate([{ name: 'commonName', value: 'passage.local' }], {
  days: 30,
  keySize: 2048,
  extensions: [
    {
      name: 'subjectAltName',
      altNames: [{ type: 2, value: 'localhost' }, ...ips.map((ip) => ({ type: 7, ip }))],
    },
  ],
});
fs.mkdirSync('certs', { recursive: true });
fs.writeFileSync('certs/lan.key', pems.private);
fs.writeFileSync('certs/lan.crt', pems.cert);
console.log('Certificat créé dans certs/ pour :', ['localhost', ...ips].join(', '));
console.log('Ajoutez au .env : HTTPS_KEY_PATH=certs/lan.key et HTTPS_CERT_PATH=certs/lan.crt');
