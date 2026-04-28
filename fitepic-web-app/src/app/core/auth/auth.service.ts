import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiConfiguration } from '../api/generated/api-configuration';
import { userSignInPost } from '../api/generated/fn/user/user-sign-in-post';
import { userRegisterPost } from '../api/generated/fn/user/user-register-post';
import { AuthResponse } from '../api/generated/models/auth-response';
import { TokenStore } from './token-store';

export interface CurrentUser {
  email: string | null;
  name: string | null;
  expiresAt: Date;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApiConfiguration);
  private readonly store = inject(TokenStore);

  private readonly userSignal = signal<CurrentUser | null>(this.loadInitialUser());
  readonly currentUser = this.userSignal.asReadonly();
  readonly isAuthenticated = computed(() => this.userSignal() !== null);

  async signIn(email: string, password: string): Promise<CurrentUser> {
    const res = await firstValueFrom(
      userSignInPost(this.http, this.config.rootUrl, { body: { email, password } }),
    );
    return this.persist(res.body);
  }

  async register(email: string, password: string, name?: string | null): Promise<CurrentUser> {
    const res = await firstValueFrom(
      userRegisterPost(this.http, this.config.rootUrl, {
        body: { email, password, name: name ?? null },
      }),
    );
    return this.persist(res.body);
  }

  signOut(): void {
    this.store.clear();
    this.userSignal.set(null);
  }

  /** Called by the auth interceptor when a 401 comes back. */
  handleUnauthorized(): void {
    this.signOut();
  }

  private persist(body: AuthResponse | null | undefined): CurrentUser {
    if (!body?.token || !body.expiresAt) {
      throw new Error('Authentication response did not include a token.');
    }
    const expiresAt = new Date(body.expiresAt);
    this.store.write({
      token: body.token,
      expiresAt,
      email: body.email ?? null,
      name: body.name ?? null,
    });
    const user: CurrentUser = {
      email: body.email ?? null,
      name: body.name ?? null,
      expiresAt,
    };
    this.userSignal.set(user);
    return user;
  }

  private loadInitialUser(): CurrentUser | null {
    const stored = this.store.read();
    if (!stored || !this.store.isFresh()) {
      if (stored) this.store.clear();
      return null;
    }
    return {
      email: stored.email,
      name: stored.name,
      expiresAt: stored.expiresAt,
    };
  }
}
