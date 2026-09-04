# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| latest release / `main` | ✅ |

## Reporting a vulnerability

**Preferred:** use GitHub's private vulnerability reporting on this repository
(*Security → Report a vulnerability*). It keeps details confidential until a fix ships.

**Alternative:** email **czkbanmu@163.com** with:

- A description of the issue and its impact
- Step-by-step reproduction (PoC scripts welcome)
- Affected version / commit hash

Please do **not** open a public issue for security reports.

You can expect an initial response within **72 hours**. We will publish a fix and a
public advisory (GitHub Security Advisory) once a patch is ready, and credit
reporters by default unless asked otherwise.

## Scope notes

LoomFlow is a self-hosted workflow runtime. Of particular interest:

- Auth / session handling (`src/lib/auth.ts`, `src/lib/server-auth.ts`)
- Code node sandbox escapes (`src/lib/tinyflow/executors/`)
- Workflow execution endpoints RCE/SSRF (`src/app/api/flow/`)
- User data isolation between accounts (`src/lib/agent/`, API routes)
- Secrets storage & decryption (`src/lib/secrets.ts`)

Known non-issues: the public demo (`30203020.xyz`) runs with its own isolated
database and test keys.
