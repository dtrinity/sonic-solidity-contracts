Goal: Add notification and robust logging/error handling.

Notifications
- Slack webhook sender (mock in tests). Mirror interface conceptually from `bot/dlend-liquidator/typescript/odos_bot/notification.ts`.

Error handling
- Categorize: network errors, revert errors (with reason), aggregator errors, config errors.
- Retries with backoff for transient RPC failures.
- Clear exit codes for CI.

Acceptance
- Unit tests cover successful and failure notifications.
- Logs redact secrets; include tx hashes and metrics.
