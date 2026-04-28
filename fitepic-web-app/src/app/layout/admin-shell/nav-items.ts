export interface NavItem {
  label: string;
  icon: string;
  route: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', icon: 'space_dashboard', route: '/' },
  { label: 'Programming', icon: 'fitness_center', route: '/programming' },
  { label: 'Connections', icon: 'group', route: '/connections' },
  { label: 'Activity', icon: 'timeline', route: '/activity' },
  { label: 'Settings', icon: 'settings', route: '/settings' },
];
