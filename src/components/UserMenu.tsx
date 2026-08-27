'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { KeyRound, LogOut, ChevronDown } from 'lucide-react';
import { useT } from '@/lib/i18n';

type MockUser = {
  name: string;
  email: string;
  avatar_url?: string;
  department?: string;
};

const MOCK_USER: MockUser = {
  name: 'User',
  email: 'user@example.com',
  department: 'Engineering',
};

export function UserMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const [loading] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md px-2 py-1">
        <div className="h-7 w-7 animate-pulse rounded-full bg-muted" />
        <div className="h-4 w-16 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const user = MOCK_USER;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex h-9 items-center gap-2 px-2"
        >
          <Avatar className="h-7 w-7">
            <AvatarImage src={user.avatar_url} />
            <AvatarFallback className="bg-primary/10 text-xs text-primary">
              {user.name.slice(0, 2)}
            </AvatarFallback>
          </Avatar>
          <span className="max-w-[100px] truncate text-sm font-medium">
            {user.name}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <div className="px-2 py-1.5">
          <div className="text-sm font-medium">{user.name}</div>
          <div className="text-xs text-muted-foreground">{user.email}</div>
          {user.department && (
            <div className="text-xs text-muted-foreground">{user.department}</div>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            // 占位：修改密码
          }}
        >
          <KeyRound className="mr-2 h-4 w-4" />
          {t('chat.changePassword')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive"
          onSelect={() => {
            const redirect = encodeURIComponent(pathname);
            router.push(`/login?redirect=${redirect}`);
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          {t('chat.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
