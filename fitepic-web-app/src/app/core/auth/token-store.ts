import { Injectable } from '@angular/core';

const TOKEN_KEY = 'fe_auth_token';
const EXPIRES_KEY = 'fe_auth_expires_at';
const EMAIL_KEY = 'fe_auth_email';
const NAME_KEY = 'fe_auth_name';

export interface StoredAuth {
  token: string;
  expiresAt: Date;
  email: string | null;
  name: string | null;
}

@Injectable({ providedIn: 'root' })
export class TokenStore {
  private cache: StoredAuth | null | undefined;

  read(): StoredAuth | null {
    if (this.cache !== undefined) return this.cache;

    const token = localStorage.getItem(TOKEN_KEY);
    const expiresAtRaw = localStorage.getItem(EXPIRES_KEY);
    if (!token || !expiresAtRaw) {
      this.cache = null;
      return null;
    }
    const expiresAt = new Date(expiresAtRaw);
    if (Number.isNaN(expiresAt.getTime())) {
      this.clear();
      return null;
    }
    this.cache = {
      token,
      expiresAt,
      email: localStorage.getItem(EMAIL_KEY),
      name: localStorage.getItem(NAME_KEY),
    };
    return this.cache;
  }

  write(auth: StoredAuth): void {
    localStorage.setItem(TOKEN_KEY, auth.token);
    localStorage.setItem(EXPIRES_KEY, auth.expiresAt.toISOString());
    if (auth.email) localStorage.setItem(EMAIL_KEY, auth.email);
    else localStorage.removeItem(EMAIL_KEY);
    if (auth.name) localStorage.setItem(NAME_KEY, auth.name);
    else localStorage.removeItem(NAME_KEY);
    this.cache = auth;
  }

  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRES_KEY);
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(NAME_KEY);
    this.cache = null;
  }

  isFresh(skewMs = 30_000): boolean {
    const stored = this.read();
    if (!stored) return false;
    return stored.expiresAt.getTime() - Date.now() > skewMs;
  }
}
