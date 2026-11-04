# A-Center implementation status

## Implemented in this revision

- Storage: existing drive roots are not recreated, drive-root targets are rejected, failed copies roll back, original data is retained, and mutations are blocked until restart after relocation.
- Workspace: noninteractive CLI input, single-turn execution, version-aware arguments, bounded execution, concurrency guard, clean answer extraction and diagnostic exit codes/logs. Conversation history is included with a bounded context budget.
- Model checks: the selected GGUF/Ollama model is tested instead of an unrelated first Ollama model. Runtime readiness checks require a real executable.
- Downloads: Range-ignoring servers restart the partial file, byte count and GGUF header checks, unique temporary/final paths and cancellation cleanup.
- Files: realpath checks prevent junction escapes; read-only/protected-file rules apply to approval and rename; directory changes require explicit auto mode. Terminal commands require user confirmation and a checked working directory.
- Windows: disk capacity is read from the storage volume, GPU names use Windows inventory, unavailable CPU utilization is shown explicitly, startup errors display a dialog.
- Task Manager now identifies itself as a manual planner. It does not pretend to execute code or Studio tests. Unimplemented runtime adapters cannot claim successful installation.
- CI smoke coverage: download pause/resume, storage rollback and relocation, project path/permission guards. Real model inference can be enabled locally with A_CENTER_TEST_MODEL and a matching llama-cli on PATH.

## Remaining product work

1. Persistent llama-server with genuine token streaming, cancellation and structured chat messages; current CLI mode reloads the model for each request.
2. Automated task execution with tools, reviewable file diffs and verified step results; currently tasks are plans only.
3. One-click runtime package download with signed/checksummed binaries, version pinning and update management; current runtime binaries are supplied manually.
4. Private/gated Hugging Face repository authentication through the OS credential store, richer filters and revision/checksum pinning.
5. Roblox Studio end-to-end testing, stale-connection detection and command recovery after app restarts.
6. Crash recovery journal spanning configuration and database relocation; source backups are retained to avoid data loss if Windows stops during a commit. Old source models must be removed manually after validating the new location.
7. Installer upgrade/uninstall UI testing and signing. Successful packaging alone does not prove installation behavior.
