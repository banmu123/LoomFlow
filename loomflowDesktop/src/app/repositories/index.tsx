/**
 * RepositoryProvider — React Context for WorkflowRepository
 *
 * 所有页面和组件通过 useRepository() 获取 repository 实例，
 * 不直接 import 具体实现。
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { WorkflowRepository } from './workflow-repository';
import { SQLiteWorkflowRepository } from './sqlite-workflow-repository';

const RepositoryContext = createContext<WorkflowRepository | null>(null);

// Singleton instance
const repository = new SQLiteWorkflowRepository();

export function RepositoryProvider({ children }: { children: ReactNode }) {
  return (
    <RepositoryContext.Provider value={repository}>
      {children}
    </RepositoryContext.Provider>
  );
}

export function useRepository(): WorkflowRepository {
  const repo = useContext(RepositoryContext);
  if (!repo) {
    throw new Error('useRepository must be used within a RepositoryProvider');
  }
  return repo;
}
