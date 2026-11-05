# Roblox Studio panel 1.4.0 (A-Center 0.4.0)

## 0.4.1 correction

Large Explorer/script snapshots previously produced HTTP 400 on a 4K context. Reproduced with the user's Nemotron GGUF: the old request contained 7355 prompt tokens for a 4096-token context. Context is now a bounded, valid JSON summary (24 instances and relevant complete script entries), rather than a 24000-character cut through raw JSON. Unrelated script source is omitted. Local Studio generation applies the actual model template, tokenizes the prompt and caps output to remaining context with a 32-token margin; fewer than 256 available output tokens produces a clear context-size error instead of a blind request. Other chat requests retain their existing behavior.

An inspection-only failed run can safely regenerate its proposal batch after a fresh inspection. Completed writes, rejected proposals and uncertain delivered mutations are not replayed. Native HTTP errors include the upstream reason/token counts, with request text and the server key redacted. Studio controls now use explicit LayoutOrder, avoiding the alphabetical default order, and Task Manager clears stale error banners when a new action starts. Update the downloaded plugin once to obtain the layout correction; the compatible bridge protocol remains 1.4.0.

The corrected request was verified against the actual Nemotron GGUF at 4K context: it returned a valid write-script proposal containing `print("çalışıyor")`. This is real local model generation, not a claim that the script was applied in native Studio. Regression coverage includes remaining-output budgeting, bounded context without unrelated sources and safe retry after model failure before proposals.

The desktop app exposes authenticated command/result and panel GET/POST routes on stable `http://127.0.0.1:7817/roblox`. The desktop UI/API still uses a private random port and a separate token. The relay rejects browser Origins and all other paths. A port conflict appears in Roblox Integration rather than failing silently.

## Update the plugin

1. Install A-Center 0.4.0 and keep it open.
2. In Roblox Integration, download **VexBridge.lua**. This file includes this app's pairing token; do not share or commit it.
3. In Studio open **Plugins → Plugins Folder**. Back up the old VexBridge copy outside this directory, then replace it with the downloaded file. Keep only one VexBridge enabled; similarly named VexRobloxAIPlugin plugins can use a different protocol/port.
4. Restart Studio, open a place, press **Connect to Studio** in A-Center and **VexBridge** in the Studio toolbar. Inside the docked panel press **Bağlan**, and allow the plugin's localhost HTTP and script-editing permissions. If Studio reports HTTP disabled, enable HTTP requests in the place's security settings.
5. Wait for a real `connected` heartbeat, then queue `inspect` with `{"service":"Workspace"}`. A returned hierarchy is a real command result. Self-test only verifies the pairing token and cannot mark Studio connected.

## Studio requests and real task execution

The panel contains a model selector (click to cycle), multiline request box, NPC/UI examples, task history, cancellation, full before/after code preview, approve/reject and guarded Undo. Selecting a cloud model sends the request and bounded existing-script context to that provider; no API key is sent to the plugin. Keep only one Studio session/bridge plugin active. Other Vex plugins may use a different protocol.

Send a request from Studio, or create a **Roblox** task in Task Manager with a selected GGUF/cloud model. Roblox tasks start generation immediately; a failed connection, missing model or invalid JSON plan produces a visible error. Other task types still use the existing Agent Engine handoff and manual checklist.

The runner first asks Studio for Explorer and bounded script context, then asks the selected model for at most 12 validated command proposals. This is a bounded proposal run, not an unrestricted autonomous agent. It never executes generated code in the desktop backend. Mutations wait in `proposed` state until explicitly approved in Studio. Commands remain ordered, so later reads cannot overtake an earlier unapproved write. Old plugins cannot consume new task/mutation commands.

Script targets support full dotted paths. New scripts are parented before UpdateSourceAsync, existing names are checked for class conflicts, and the editor buffer is read back and compared with the proposal. Previous source is retained in the command result database, and edits use ChangeHistoryService recording for Undo. An update failure attempts to restore the previous source; backup restore failures are reported. Undo only acts when the latest undo entry is VexBridge, and does not cancel the task or prove the place still matches an earlier result.

Acknowledged and read-back-verified commands put the task in `awaiting_review`, never automatically `completed`. Run Studio Play tests manually. Cancellation fails undelivered commands; an already delivered edit may finish and must be inspected. Rejected/failed/uncertain commands are not automatically replayed. A backend restart pauses unfinished jobs. If a delivered result was lost after a plugin restart, inspect Studio and explicitly Disconnect/Reconnect to clear uncertain commands before creating a new task.

`npm run test:roblox` exercises the real database, task worker and API routes with mock model output and a simulated Studio client: automatic task start, context acquisition, proposal gating, ordered delivery, duplicate approval/result guards, cancellation and rejection of mismatched read-back. The plugin compiles with official Luau 0.745. These checks do **not** validate native Studio widgets, permission dialogs or real DataModel/Undo behavior; a real Studio end-to-end pass is still required.

The endpoint remains stable across app restarts. Changing the pairing token requires downloading the plugin again. Check Installation reports detected Vex plugin files, token/endpoint/version matches without exposing tokens. Green status expires after 15 seconds without a heartbeat. An explicit disconnect stops delivery and fails outstanding commands. Inspect Studio before retrying any command whose result is uncertain; running commands are never automatically replayed.

Plugin errors are visible in Studio Output. RequestAsync reports HTTP status, script reads use GetEditorSource and writes use UpdateSourceAsync. Failed property writes are returned as failures. Results retry until acknowledged without executing the command again; duplicate matching acknowledgements are safe.

`npm test` runs the actual relay and HTTP routes with a temporary database and a simulated Studio HTTP client. It verifies pairing/origin isolation, heartbeat, concurrent command claims, result acknowledgement and disconnect. This is a transport regression test, not a real Studio execution test; Studio UI and actual DataModel changes still need validation in Studio.

Primary contracts: [HttpService.RequestAsync](https://create.roblox.com/docs/reference/engine/classes/HttpService#RequestAsync), [ScriptEditorService](https://create.roblox.com/docs/reference/engine/classes/ScriptEditorService), and [Studio release 659 (.lua plugins)](https://create.roblox.com/docs/release-notes/release-notes-659).
