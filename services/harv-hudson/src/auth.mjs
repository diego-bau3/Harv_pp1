import crypto from 'node:crypto';
export async function getToken(store,vault) {
  const saved=store.getSetting('api-token-dpapi');
  if(saved)return vault.unprotect(saved);
  const token=crypto.randomBytes(32).toString('base64url');
  store.setSetting('api-token-dpapi',await vault.protect(token));return token;
}
