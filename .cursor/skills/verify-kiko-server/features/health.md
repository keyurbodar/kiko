# health

Proves the Worker is up and answers.

```bash
bun kiko health --url http://localhost:8787
```

Pass: exit code 0 and an ok line. Fail: connection refused (the server is not running) or a non-ok status.
