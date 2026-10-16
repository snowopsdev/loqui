# Task 2 implementation report

## Status

DONE. Form-control borders now use a dedicated 3:1 edge token in light and Plum Night. Global native-field focus-visible rules draw a full-opacity ring and the primitives no longer carry focus ring utilities that the unlayered rules override. Input and Textarea now use the shared theme tokens, and DESIGN.md documents the behavior.

## TDD evidence

- RED: `export PATH=/home/snowdesk/.local/share/mise/installs/node/24.21.0/bin:$PATH; npm test -- test/components/formControlBorders.test.js`
- Before implementation, 0/4 tests passed. The first failure showed the expected missing light `--color-input-border` token (`undefined`); the remaining failures showed the old resting edge, missing unlayered `:focus-visible` rules, and old primitive classes.
- GREEN: `export PATH=/home/snowdesk/.local/share/mise/installs/node/24.21.0/bin:$PATH; npm test -- test/components/formControlBorders.test.js test/components/plumNight.test.js test/components/fieldDirectionPolicy.test.js`
- Result: 12/12 passing, no failures or skipped tests.

## Files changed

- `src/index.css`: added `--color-input-border` (`#858585` light, `#8c6b7b` Plum Night), applied it to native fields, changed focus to `:focus-visible` with a full-opacity ring and 1px background gap, and switched the touched transition timings to `--motion-fast` / `--motion-ease-std`.
- `src/components/ui/input.tsx` and `src/components/ui/textarea.tsx`: use the shared border and surface tokens; removed hover edge lightening and component focus ring utilities. Textarea no longer uses light-only neutral/indigo colors.
- `test/helpers/harness/cssRules.js` and `test/components/formControlBorders.test.js`: added the CSS rule parser and focused contrast/cascade/component tests.
- `DESIGN.md`: documented the contrast threshold and focus ring behavior.

## Self-review and concerns

`git diff --check` passed. The contrast test scores the actual light and dark tokens across all eight listed surfaces. The cascade test confirms both focus rules are unlayered and no translucent global focus ring remains. Task 1 status colors were not changed.

The design hook reported three existing font findings in `src/index.css` at lines 959, 1905, and 1997 (`Caveat Variable`, `Sfmono-Regular`, and `Apple Color Emoji`). They are outside Task 2 and were left standing; none were suppressed. No unrelated formatting changes were retained.
