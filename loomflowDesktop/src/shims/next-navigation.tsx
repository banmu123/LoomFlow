/**
 * next/navigation shim — maps to react-router-dom hooks
 */
import {
  useNavigate,
  useLocation,
  useParams,
  useSearchParams,
  useMatch,
} from 'react-router-dom';

export function useRouter() {
  const navigate = useNavigate();
  return {
    push: (url: string) => navigate(url),
    replace: (url: string) => navigate(url, { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    prefetch: () => {}, // no-op in desktop
    refresh: () => window.location.reload(),
  };
}

export function usePathname(): string {
  const location = useLocation();
  return location.pathname;
}

export { useParams, useSearchParams };

export function redirect(url: string) {
  window.location.href = url;
}
