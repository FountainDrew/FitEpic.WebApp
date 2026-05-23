import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/auth/auth.guard';
import { workoutEditorCanDeactivate } from './features/workouts/unsaved-changes.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/register-page').then((m) => m.RegisterPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./layout/admin-shell/admin-shell').then((m) => m.AdminShell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage),
      },
      {
        path: 'dashboard/weekly-stats/duration',
        pathMatch: 'full',
        loadComponent: () =>
          import(
            './features/dashboard/total-duration-details/total-duration-details-page'
          ).then((m) => m.TotalDurationDetailsPage),
      },
      {
        path: 'dashboard/monthly-stats',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/dashboard/monthly-stats/monthly-stats-page').then(
            (m) => m.MonthlyStatsPage,
          ),
      },
      {
        path: 'profile',
        pathMatch: 'full',
        redirectTo: 'settings',
      },
      {
        path: 'gyms',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/gyms/gyms-list-page').then((m) => m.GymsListPage),
      },
      {
        path: 'gyms/join',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/gyms/join-gym-page').then((m) => m.JoinGymPage),
      },
      {
        path: 'gyms/my-inbox',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/gyms/my-inbox-page').then((m) => m.MyInboxPage),
      },
      {
        path: 'gyms/:gymId',
        loadComponent: () =>
          import('./features/gyms/gym-detail-shell').then((m) => m.GymDetailShell),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'overview' },
          {
            path: 'overview',
            loadComponent: () =>
              import('./features/gyms/tabs/overview-tab').then((m) => m.OverviewTab),
          },
          {
            path: 'members',
            loadComponent: () =>
              import('./features/gyms/tabs/members-tab').then((m) => m.MembersTab),
          },
          {
            path: 'groups',
            loadComponent: () =>
              import('./features/gyms/tabs/groups-tab').then((m) => m.GroupsTab),
          },
          {
            path: 'groups/:groupId',
            loadComponent: () =>
              import('./features/gyms/tabs/group-detail').then((m) => m.GroupDetail),
          },
          {
            path: 'requests',
            loadComponent: () =>
              import('./features/gyms/tabs/requests-tab').then((m) => m.RequestsTab),
          },
          {
            path: 'invites',
            loadComponent: () =>
              import('./features/gyms/tabs/invites-tab').then((m) => m.InvitesTab),
          },
          {
            path: 'workouts',
            loadComponent: () =>
              import('./features/gyms/tabs/workouts-tab').then((m) => m.WorkoutsTab),
          },
          {
            path: 'schedule',
            loadComponent: () =>
              import('./features/gyms/tabs/schedule-tab').then((m) => m.ScheduleTab),
          },
        ],
      },
      {
        path: 'workouts/new',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/workouts/workout-editor-page').then((m) => m.WorkoutEditorPage),
        canDeactivate: [workoutEditorCanDeactivate],
      },
      {
        path: 'workouts/:id/edit',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/workouts/workout-editor-page').then((m) => m.WorkoutEditorPage),
        canDeactivate: [workoutEditorCanDeactivate],
      },
      {
        path: 'workouts/log/:scheduledWorkoutId',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/workouts/workout-log-page').then((m) => m.WorkoutLogPage),
      },
      {
        path: 'settings',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/settings/settings-page').then((m) => m.SettingsPage),
      },
      {
        path: 'settings/my-quotes',
        loadComponent: () =>
          import('./features/quotes/manage-quotes-page').then((m) => m.ManageQuotesPage),
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
