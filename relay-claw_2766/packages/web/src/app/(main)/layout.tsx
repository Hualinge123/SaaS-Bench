'use client';

import MainShell from '@/components/MainShell';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return <MainShell>{children}</MainShell>;
}