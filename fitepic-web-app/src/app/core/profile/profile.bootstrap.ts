import { inject, provideAppInitializer } from '@angular/core';

import { TokenStore } from '../auth/token-store';
import { ProfileService } from './profile.service';

/**
 * App initializer that pre-loads the authenticated athlete's profile so the
 * caller's identity (athlete id, display name, timezone, gym-owner flag, etc.)
 * is reliably available to every component without lazy load-on-miss guards.
 *
 * Skips the load when there's no fresh token — unauthenticated users get the
 * login page via the auth guard, and we don't want to fire a doomed 401.
 * Errors during the load are swallowed: the auth interceptor handles 401
 * elsewhere, and other failures should not block app bootstrap.
 *
 * The post-login profile load is handled separately by `AuthService.signIn`
 * (and `register`), since the initializer has already run by then.
 */
export function provideProfileBootstrap() {
  return provideAppInitializer(() => {
    const tokenStore = inject(TokenStore);
    const profileService = inject(ProfileService);
    if (!tokenStore.isFresh()) return;
    return profileService.load().catch(() => undefined);
  });
}
