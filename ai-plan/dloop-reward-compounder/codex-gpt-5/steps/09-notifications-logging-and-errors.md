Goal: Add notification and logging facilities with robust error handling.

Notifications
- Implement `NotificationManager` with Slack webhook client behind an interface.
- Support message types: success (profit summary), warning (skipped), error (revert/insufficient rewards).
- Tests mock webhook responses; no real network calls.

Logging
- Structured JSON logs with correlation id per run, include timings and gas cost estimate.

Errors
- Distinguish transient (RPC, aggregator) vs logical (unprofitable, deposit disabled).
- Retries for transient issues with backoff; no retries for logical declines.

Acceptance
- Unit tests for NotificationManager (mocked HTTP client) and error classification.

