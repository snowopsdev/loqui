# Task 5: Pin the onboarding shell and clear the macOS traffic lights

Status: DONE

Implemented the onboarding shell height pinning, Darwin physical-left header clearance at wide and narrow sizes, `data-platform` propagation through both onboarding roots, and the D10 layout documentation. Added renderer and stylesheet coverage in `test/components/onboardingShell.test.js`.

TDD evidence:
- RED: `PATH=/home/snowdesk/.local/share/mise/installs/node/24.21.0/bin:$PATH npm test -- test/components/onboardingShell.test.js` failed all 3 new tests before implementation: missing `html:has(...)` height rule, missing Darwin clearance rule, and missing `data-platform` on WelcomeScreen.
- GREEN: `PATH=/home/snowdesk/.local/share/mise/installs/node/24.21.0/bin:$PATH npm test -- test/components/onboardingShell.test.js test/components/onboardingCleanupWiring.test.js test/components/personalWorkspace.test.js` passed 14/14.
- `git diff --check` passed.

Files changed: `DESIGN.md`, `src/components/OnboardingFlow.tsx`, `src/components/onboarding/WelcomeScreen.tsx`, `src/styles/onboarding-welcome.css`, `test/components/onboardingShell.test.js`.

Self-review: Confirmed both roots receive the platform value sourced from the preview-aware `platform` const. The clearance rule uses physical `padding-left` and includes the narrow breakpoint override. No concerns.

Full suite is deferred to the whole-plan gate per task execution context.
