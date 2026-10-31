// TEMPLATE: stylelint.config.mjs (repo root)
// WHAT: lints styles.css with the same two checks Obsidian's community-plugin review applies.
// CHANGE: nothing. Re-check the browser target when the review's target moves.
// GUARDS: the review flagged `!important` and partially supported properties (e.g. the `text-decoration-*` longhands)
//         on a plugin that had shipped them for months. check-release asserts this file keeps both rules enabled.
//   - declaration-no-important
//   - declaration-block-no-duplicate-properties (review warning "Unexpected duplicate"; put an engine fallback in an @supports block after the base rule)
//   - stylelint-no-unsupported-browser-features, "only partially supported" findings
//
// The browser target is a calibrated guess at the engine of the Obsidian build the review runs against, not a
// published fact: `chrome 138` reproduced the review's findings at the same lines and none after the fix. Both rules are
// `error` here although the review shows the browser-feature ones as warnings: a warning in the review is still a
// finding on the plugin's page, so CI treats it as a failure.
export default {
  plugins: ["stylelint-no-unsupported-browser-features"],
  rules: {
    "declaration-no-important": true,
    "declaration-block-no-duplicate-properties": true,
    "plugin/no-unsupported-browser-features": [true, { browsers: ["chrome 138"], severity: "error" }],
  },
};
