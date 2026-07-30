'use client';

import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center px-4 py-16">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="mb-1 text-lg font-medium text-foreground">
            页面出现了错误
          </h2>
          <p className="mb-4 max-w-sm text-center text-sm text-muted-foreground">
            {this.state.error?.message ?? '发生了未知错误，请重试或刷新页面'}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              重试
            </Button>
            <Button onClick={() => window.location.reload()}>刷新页面</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
