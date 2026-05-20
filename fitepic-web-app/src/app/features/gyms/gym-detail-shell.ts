import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';

import { GymsService } from '../../core/gyms/gyms.service';
import { GymRoleService } from '../../core/gyms/gym-role.service';
import {
  canManageGym,
  canProgramWorkouts,
  canViewRoster,
  isOwner,
} from '../../core/gyms/gym-role';
import { ProfileService } from '../../core/profile/profile.service';
import { GymResponse } from '../../core/api/generated/models/gym-response';

interface TabSpec {
  label: string;
  path: string;
  visible: () => boolean;
}

@Component({
  selector: 'app-gym-detail-shell',
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
  ],
  templateUrl: './gym-detail-shell.html',
  styleUrl: './gym-detail-shell.scss',
})
export class GymDetailShell implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly gymsService = inject(GymsService);
  private readonly roleService = inject(GymRoleService);
  private readonly profileService = inject(ProfileService);

  protected readonly gymId = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);

  protected readonly gym = computed<GymResponse | null>(() => {
    const id = this.gymId();
    if (!id) return null;
    return this.gymsService.gyms().find((g) => g.id === id) ?? null;
  });

  protected readonly role = computed(() => this.roleService.forGym(this.gymId()));

  protected readonly tabs: ReadonlyArray<TabSpec> = [
    { label: 'Overview', path: 'overview', visible: () => true },
    { label: 'Members', path: 'members', visible: () => canViewRoster(this.role()) },
    { label: 'Groups', path: 'groups', visible: () => true },
    { label: 'Requests', path: 'requests', visible: () => canManageGym(this.role()) },
    { label: 'Invites', path: 'invites', visible: () => canManageGym(this.role()) },
    // Per v7: gym workout library and per-group schedule oversight are both
    // staff-only surfaces. Athletes consume scheduled workouts through their
    // personal feed (not yet surfaced on the web).
    { label: 'Workouts', path: 'workouts', visible: () => canProgramWorkouts(this.role()) },
    { label: 'Schedule', path: 'schedule', visible: () => canProgramWorkouts(this.role()) },
  ];

  protected readonly visibleTabs = computed(() => this.tabs.filter((t) => t.visible()));
  protected readonly canEdit = computed(() => canManageGym(this.role()));
  protected readonly canDelete = computed(() => isOwner(this.role()));

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('gymId');
    this.gymId.set(id);
    if (!id) {
      this.notFound.set(true);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      // Role computation needs the gym + membership caches; the profile
      // (caller's athlete id) is loaded up-front via the app initializer.
      const cached = this.gymsService.gyms().find((g) => g.id === id);
      if (!cached) await this.gymsService.bootstrap();
      // Always refresh the targeted gym so we have its latest state.
      await this.gymsService.getGym(id);
    } catch (err: unknown) {
      // 404 (non-member) means the gym either doesn't exist or we're not in it.
      const status =
        typeof err === 'object' && err && 'status' in err ? (err as { status: number }).status : 0;
      if (status === 404) this.notFound.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected back(): void {
    void this.router.navigateByUrl('/gyms');
  }
}
