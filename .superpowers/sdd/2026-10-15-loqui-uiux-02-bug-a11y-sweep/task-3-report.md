# Task 3 implementation report

## Status

DONE

## Implementation

- Added `test/components/focusRings.test.js`, which parses `src/index.css` and rejects unlayered focus rules that can set `box-shadow` or `outline` on buttons and button/tab roles.
- Refactored the Button recolouring assertion in `test/components/colorRoles.test.js` into `ringRecolouringClasses` and `splitVariants`. Variant splitting now respects both square brackets and parentheses, keeping colons within arbitrary values in the utility.
- Added mutation coverage for `hover:[opacity:0.5]` and `hover:[filter:brightness(1.1)]`, alongside a regular brightness mutation and non-offender classes.
- No runtime or CSS changes remain.

## TDD evidence

- RED: `npm test -- test/components/colorRoles.test.js` failed the newly added mutation assertion as expected. Actual offenders contained only `active:brightness-95`; both arbitrary-property mutations were missed by the old colon split.
- Cascade mutation: temporarily added `button:focus-visible { box-shadow: none; }` to `src/index.css`; `npm test -- test/components/focusRings.test.js` failed and identified `button:focus-visible`. The temporary CSS rule was removed.
- GREEN: `npm test -- test/components/focusRings.test.js test/components/colorRoles.test.js test/components/brandGlow.test.js` passed all 18 tests with zero failures.

## Files changed

- `test/components/colorRoles.test.js`
- `test/components/focusRings.test.js`

## Self-review

- Confirmed the arbitrary-property mutation assertion detects both cases from the brief and ignores the listed non-offenders.
- Confirmed the focus-ring guard fails against the specified unlayered CSS mutation and passes after it is removed.
- `git diff --check` passed.
- Existing `react-i18next` test warning (`NO_I18NEXT_INSTANCE`) appeared during color role tests; test results still passed.

## Concerns

None.
