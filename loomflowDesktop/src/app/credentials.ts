/**
 * CredentialService — 凭证管理抽象层
 *
 * 当前阶段：接口定义 + 暂时用 localStorage fallback。
 * 未来：macOS 用 Keychain、Windows 用 Credential Manager。
 *
 * 安全原则：API Key / Token / Secret 绝不写入 SQLite。
 */

export interface CredentialService {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

/**
 * DesktopCredentialService — 先用内存存储（会话内有效）。
 * 后续可替换为 Tauri 插件调用系统 Keychain。
 */
export class DesktopCredentialService implements CredentialService {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(): Promise<string[]> {
    return Array.from(this.store.keys());
  }
}

// Singleton
export const credentialService: CredentialService = new DesktopCredentialService();
