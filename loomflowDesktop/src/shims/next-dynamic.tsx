/**
 * next/dynamic shim — Vite handles code splitting natively
 * Just return the component directly
 */
import { useState, useEffect, type ComponentType } from 'react';

interface DynamicOptions {
  ssr?: boolean;
  loading?: ComponentType;
}

export default function dynamic<P extends object>(
  factory: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
  _options?: DynamicOptions,
): ComponentType<P> {
  // In desktop (Vite), we use React.lazy for code splitting
  // But for simplicity, return a wrapper that loads on mount
  const LazyComponent = factory;

  function DynamicComponent(props: P) {
    const [Component, setComponent] = useState<ComponentType<P> | null>(null);

    useEffect(() => {
      let cancelled = false;
      LazyComponent().then((mod) => {
        if (!cancelled) {
          const Comp = 'default' in mod ? mod.default : mod;
          setComponent(() => Comp as ComponentType<P>);
        }
      });
      return () => { cancelled = true; };
    }, []);

    if (!Component) return null;
    return <Component {...props} />;
  }

  return DynamicComponent as ComponentType<P>;
}
