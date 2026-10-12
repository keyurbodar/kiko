# Kernel browser (DeepSeek, read-only)
Area about 3,600 lines; about 129 removable (3.6%). No behavior change.
1. Kernel key and lease encryption: 35 (store.ts seal/open, keyring, kek columns; profileName becomes a constant). Low-medium, needs a schema step.
2. KernelConnection pass-through layer folded into KernelWiring: 25. Medium; moves kernel-files test.
3. Account-deletion wipe chain and deleteProfile: 22. Low.
4. runTasks unreachable skipped branch: 8. Low.
5. checkAgentId on fetch and file RPCs that ignore agentId: 8. Medium.
6. KernelStore generation guard for a state that cannot happen: 6. Medium.
7. onPopup listener set, no subscriber: 6. Low.
8. waitFor match parameter, no caller: 4. Low.
9. BrowserConnection.isOpen, test only: 3. Low.
10. Double body cap on browser_fetch, and res.truncated dropped (a real bug: the model never learns a body was cut): 3. Medium.
11-14. onFast, dialogs option, curl timeoutMs, dead exports: 9. Low.
