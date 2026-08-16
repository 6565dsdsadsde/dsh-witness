# Contributing

Contributions must be verifiable — the acceptance suite is the contract.

## Ways to contribute

1. **Bug reports** — issue with: environment (Windows version / Node version), steps, and task-directory state (the directory *is* the truth source — include its structure).
2. **Test-driven fixes** — behavior changes need regression assertions in `test/witness-final-test.ts`.
3. **Platform ports** — the lock protocol and sandbox are Windows-specific today; ports need their own real-process adoption tests.

## Rules

- `npm test` must stay green — the 12 scenarios / 34 assertions are the acceptance contract.
- No claims without evidence: README statements about platforms and numbers must match what was actually tested.
- Sandbox boundary tests (group D) require a non-elevated Windows environment; CI runs A/B/C groups (see test file notes).

## Development

```sh
npm run build
npm test     # node --experimental-strip-types test/witness-final-test.ts
```
