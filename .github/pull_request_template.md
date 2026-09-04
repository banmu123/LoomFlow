## What does this PR do?

<!-- A short summary. Link related issues with "Fixes #123". -->

## How was it tested?

<!-- e.g. added unit tests in X, manual steps on canvas Y -->

## Checklist

- [ ] `pnpm validate` (type-check + lint) passes
- [ ] `pnpm test` passes; new business logic has tests
- [ ] User-facing strings go through i18n (`src/messages/zh.ts` + `en.ts`)
- [ ] DB changes are appended idempotently to `scripts/supabase-updates.sql`
- [ ] No secrets (API keys, tokens, `.env`) are committed
- [ ] Scope stays within the core loop: *natural language → workflow → canvas → API*
