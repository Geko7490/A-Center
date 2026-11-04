# Roblox Studio bridge 1.3.0 (A-Center 0.2.1)

The desktop app now exposes only two authenticated Studio routes on stable `http://127.0.0.1:7817/roblox`. The desktop UI/API still uses a private random port and a separate token. The relay rejects browser Origins and all other paths. A port conflict appears in Roblox Integration rather than failing silently.

## Update the plugin

1. Install A-Center 0.2.1 and keep it open.
2. In Roblox Integration, download **VexBridge.lua**. This file includes this app's pairing token; do not share or commit it.
3. In Studio open **Plugins → Plugins Folder**. Back up the old VexBridge copy outside this directory, then replace it with the downloaded file. Keep only one VexBridge enabled; similarly named VexRobloxAIPlugin plugins can use a different protocol/port.
4. Restart Studio, open a place, press **Connect to Studio** in A-Center and **VexBridge** in the Studio toolbar. Allow the plugin's localhost HTTP access request. If Studio reports HTTP disabled, enable HTTP requests in the place's security settings.
5. Wait for a real `connected` heartbeat, then queue `inspect` with `{"service":"Workspace"}`. A returned hierarchy is a real command result. Self-test only verifies the pairing token and cannot mark Studio connected.

The endpoint remains stable across app restarts. Changing the pairing token requires downloading the plugin again. Check Installation reports detected Vex plugin files, token/endpoint/version matches without exposing tokens. Green status expires after 15 seconds without a heartbeat. An explicit disconnect stops delivery and fails outstanding commands. Inspect Studio before retrying any command whose result is uncertain; running commands are never automatically replayed.

Plugin errors are visible in Studio Output. RequestAsync reports HTTP status, script reads use GetEditorSource and writes use UpdateSourceAsync. Failed property writes are returned as failures. Results retry until acknowledged without executing the command again; duplicate matching acknowledgements are safe.

`npm test` runs the actual relay and HTTP routes with a temporary database and a simulated Studio HTTP client. It verifies pairing/origin isolation, heartbeat, concurrent command claims, result acknowledgement and disconnect. This is a transport regression test, not a real Studio execution test; Studio UI and actual DataModel changes still need validation in Studio.

Primary contracts: [HttpService.RequestAsync](https://create.roblox.com/docs/reference/engine/classes/HttpService#RequestAsync), [ScriptEditorService](https://create.roblox.com/docs/reference/engine/classes/ScriptEditorService), and [Studio release 659 (.lua plugins)](https://create.roblox.com/docs/release-notes/release-notes-659).
