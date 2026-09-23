# Network inventory

Loqui has no hosted backend or OpenWhispr service dependency. Optional features still make network requests. See [privacy and network behavior](PRIVACY.md) for what each request can contain and how to disable it.

This document is an inventory, **not an enforced firewall allowlist**. Model sources can redirect to storage/CDN hosts, custom endpoints are user-selected, URL imports can contact arbitrary chosen sites, and Codex manages its own service connections. Do not assume that allowing a short list of domains captures all possible destinations.

| Group                                  | Source of the exact destination                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Loqui updates                          | `src/config/product.json`, `electron-builder.cjs`, and the main-process update manager; only the Loqui GitHub repository is configured |
| Build runtimes and support models      | `runtime-assets.json` plus dependency installation; archives and licenses belong to their upstream projects                            |
| User-selected local models             | `src/models/modelRegistryData.json` and local model managers                                                                           |
| API providers and compatible endpoints | The chosen provider's integration and explicit endpoint settings                                                                       |
| ChatGPT subscription                   | Installed, version-checked Codex app-server and its managed authentication flow                                                        |
| Google/Microsoft calendars             | `googleCalendarOAuth.js`, `googleCalendarManager.js`, `microsoftCalendarOAuth.js`, and `microsoftCalendarManager.js` in `src/helpers/` |
| URL imports                            | The selected URL, redirects, and associated media sources                                                                              |

For fully offline use, prepare the local models you need, select local providers, disable automatic updates, and leave remote calendar/import/search integrations unused or disconnected. Verify the workflow in a disconnected environment; a successful browser simulation does not establish offline desktop behavior.

Contributions that add a network destination or send a new category of user content must update this inventory and the privacy documentation.
