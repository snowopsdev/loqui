# Public repository readiness

Loqui is intended to be an independent public repository at `snowopsdev/loqui`. This checklist separates publishing source from approving downloadable releases. A prepared working tree is not evidence that GitHub settings, signed builds, or hardware tests have passed.

## Source publication

- [x] Authenticate a maintainer's GitHub CLI/session with access to the target repository.
- [x] Verify local `origin` targets `snowopsdev/loqui` and `upstream` points to OpenWhispr.
- [x] Verify the live repository owner, public visibility, and independent-repository status.
- [x] Verify the sanitized history intended for publication, including every branch/tag that will be pushed. Preserve the original local repository and the private history-rewrite map.
- [ ] Run `npm run publication:check`, then a secret scan of the current tree and intended history. Review exact suppressions; rotate any real exposed credentials before publishing.
- [x] Confirm restricted artwork, personal data, generated installers, model weights, local profiles, and private diagnostic artifacts are absent from intended refs, apart from the documented historical helper exception below.
- [x] Confirm MIT attribution, third-party notices, license/source references, and committed distributable assets are retained.
- [ ] Push only the application branch and explicitly named Loqui version tags. Never push with `--mirror` or `--tags` from a checkout containing upstream refs.
- [ ] Enable branch protection requiring the `CI` status, pull requests, and resolved conversations; block force pushes and branch deletion.
- [ ] Enable dependency alerts, secret scanning and push protection where available, and private vulnerability reporting.
- [x] Provide issue and PR templates, contribution/support/security documentation, and a moderation reporting route; validate local documentation links.
- [ ] Confirm those links and private vulnerability reporting work from the live public repository.

Historical restricted Nucleo/Yowza assets require the approved sanitized publication copy; do not publish the original unsanitized history. See [verification](VERIFICATION.md) for previously recorded audit evidence. Repeat checks after the final publication commit and any additional history changes.

`npm run publication:check` inspects tracked and unignored working-tree files, including newly added files. It rejects private environment/signing files, databases, executable/model artifacts, generated directories, external symlinks, and files over 10 MiB. New UI icons go through the existing Lucide adapter; vendored icon component files and the removed paid-font directory are rejected. This check runs in CI alongside a pinned, checksum-verified Gitleaks scan of Git history. It is a guard against common mistakes, not a substitute for reviewing personal content, redistribution rights, or new history before a push. The obsolete historical secret-scan suppressions have been removed.

The local preservation check confirmed that the original repository and removed artwork remain available privately. The rewrite map is retained under the publication checkout's `.git/filter-repo/` directory, outside Git's published tree. Only local `main` is selected for the first push; no Loqui release tag will be created until release acceptance is complete.

## Release publication

- [ ] Complete hosted Linux x86_64 and Apple Silicon macOS checks on the intended release commit.
- [ ] Configure the protected `release` environment and reviewer before supplying signing secrets.
- [ ] Add Apple certificate/notarization credentials through secure GitHub secret entry, never source control, chat, issues, or logs.
- [ ] Verify Developer ID signing, notarization, stapling, Gatekeeper acceptance, package integrity, and packaged native modules.
- [ ] Test real microphone, shortcuts, paste, and meeting capture on the supported platforms.
- [ ] Test a signed beta-to-beta Mac update and installed AppImage update, including content and settings preservation.
- [ ] Confirm a failed platform/signing job cannot assemble a complete draft, and published versions cannot be overwritten.
- [x] Verify local failure fixtures reject unreleased versions, missing platform/update artifacts, changed checksums, GitHub errors, and published/different-commit draft retries. Validate assembly with existing development artifacts without treating them as signed releases.
- [ ] Review the complete draft and publish manually. Do not rebuild at publication time.

The [release procedure](RELEASING.md) describes the credentials, artifacts, and version/tag rules. The first public release remains a reviewed beta.

## Source audit evidence (2026-09-23)

The publication audit reviewed `main` at `8bd2f5c0`: 2,248 reachable commits and 15,717 unique blobs. At that point, `main` was the only local branch and there were no tags. This scope does not approve new refs or later changes automatically.

- Gitleaks 8.28.0 found no secrets across 1,921 patch-bearing commits (about 29.78 MB). A second run from outside the checkout used an empty ignore file and disabled inline allow markers; it also found no secrets.
- Comparison against the original restricted assets confirmed all 125 blobs (124 Nucleo icon components and the Yowza README) are absent from reachable publication history, including under other paths. Historical script/map references remain, but do not contain those assets.
- A scan of all text blobs for known personal machine, home-directory, and private-network identifiers found none. Remaining user-path/IP examples were reviewed as fixtures or documentation.
- No current tracked executable installer or database artifact, private credential path, or historical blob larger than 1 MB was found. The largest asset was an 878,151-byte ICNS. MIT upstream/Loqui attribution and OFL/ISC font/icon notices are retained.
- **Historical exception:** a 52,352-byte upstream-generated Mach-O helper at `resources/bin/macos-mic-check` remains only in inherited history. It was introduced in `62588443` and removed in `b48fab67`; it is not in the current tree or a current release package. The source audit retains this historical artifact explicitly rather than claiming the entire history is binary-free.

No source-publication blocker was identified by that scoped audit. Recheck the final publication commit, preserve the sanitized history, and keep private audit reports and rewrite maps outside the repository. These results do not certify signed releases or hardware behavior.

## Pending external checks

On 2026-09-23, maintainer authentication was verified and `snowopsdev/loqui` was created as an independent public repository. The checked items above record completed work; unchecked remote and release checks still require verification. Historical local development-package results are not a substitute for signed release and hardware acceptance.
