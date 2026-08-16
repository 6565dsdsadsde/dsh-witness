# Security Policy

## Supported versions

Only the latest tagged release receives security fixes. The project is in early public preview.

## Reporting a vulnerability

Do **not** open a public issue. Report privately via GitHub's [private vulnerability reporting](https://github.com/6565dsdsadsde/dsh-witness/security/advisories/new), including:

1. Affected version (tag or commit)
2. Steps to reproduce
3. Impact assessment

Acknowledgment within 3 days; advisory published after a fix ships.

## Scope

Reportable when an attacker can:

- Break out of the per-task sandbox (ACL confinement) on a tested platform
- Forge the lock protocol in a way that corrupts adoption state without being detectable (tampered protocol)
- Cause the registry to write outside `jobsRoot` / `indexDbPath`

## Out of scope

- Arbitrary native code (P/Invoke) self-rescuing ACLs as the file owner — documented boundary; restricted tokens are the official answer (see the official Harness sandbox recipe)
- A task destroying its own output — self-harm only, visible in the evidence chain
