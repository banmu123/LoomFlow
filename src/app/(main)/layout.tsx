import { MainLayoutClient } from '@/components/MainLayoutClient';

export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <MainLayoutClient>{children}</MainLayoutClient>;
}
