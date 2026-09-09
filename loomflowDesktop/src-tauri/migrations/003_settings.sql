-- Migration 003: Settings
-- LoomFlow Desktop — SQLite schema
-- Note: sensitive credentials (API keys, tokens) should NOT be stored here.
-- They belong in the OS Keychain (macOS Keychain / Windows Credential Manager).
-- This table stores non-sensitive user preferences only.

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('theme', 'system'),
    ('locale', 'zh-CN'),
    ('autosave_enabled', 'true'),
    ('autosave_debounce_ms', '2000');
