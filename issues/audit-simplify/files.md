# Files and bash (DeepSeek, read-only)
Area 2,310 non-blank lines; about 100 removable (4.3%).
1. router.ts user-id request scan: 24 (single owner, no identity to forge). Medium.
2. Session lookup and account-deleted 410 in file routes: 18. Low after single owner.
3. Storage quota and its full R2 list per upload: 16 (removes a bucket scan on every put). Medium.
4. Three change types into one (room-fs, file-index, bash): 10. Medium.
5. Legacy files send path (pending legacyFiles, protocol field): 9. Low.
6. Three copies of isControl: 8. Low.
7. sqlite_master guards in listSpace: 3. Low.
8. PendingUploads.keys (only for deletion): 3. Low.
9. Double overRead handling in bash: 3. Medium.
10. One home constant: 2. Low.
11. Dead guards and params: 4. Low.
12-13. 11 unused exports, 3 dead columns (no line savings).
