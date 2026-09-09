/**
 * next/link shim — maps to react-router-dom Link
 */
import { Link as RouterLink } from 'react-router-dom';
import type { ReactNode, MouseEvent } from 'react';

interface NextLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
  title?: string;
  prefetch?: boolean;
  onClick?: (e: MouseEvent) => void;
  onMouseEnter?: () => void;
  replace?: boolean;
  [key: string]: unknown;
}

export default function Link({ href, children, prefetch, ...props }: NextLinkProps) {
  return (
    <RouterLink to={href} {...props}>
      {children}
    </RouterLink>
  );
}

export { Link };
