export interface NavItem {
  label: string;
  icon: string;
  route: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', icon: 'space_dashboard', route: '/' },
  { label: 'Schedule', icon: 'event', route: '/schedule' },
  { label: 'Workout Library', icon: 'library_books', route: '/workouts/library' },
  { label: 'Gyms', icon: 'fitness_center', route: '/gyms' },
  { label: 'Connections', icon: 'group', route: '/connections' },
  { label: 'Activity', icon: 'timeline', route: '/activity' },
  { label: 'Profile Settings', icon: 'settings', route: '/settings' },
];
