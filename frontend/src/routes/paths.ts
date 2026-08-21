import type { Role } from '@/types/api';

/** Where each role lands after signing in. */
export function homeFor(role: Role): string {
  switch (role) {
    case 'donor':
      return '/donor/dashboard';
    case 'blood-bank':
      return '/bank/dashboard';
    case 'hospital':
      return '/requests';
    case 'admin':
      return '/admin/dashboard';
    default:
      return '/';
  }
}
