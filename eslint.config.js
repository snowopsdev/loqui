const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      ".superpowers/**", // retained local verification evidence, not authored source
      "dist/**",
      "node_modules/**",
      ".superpowers/**", // ignored nonproduct controller/QA workspace; retained validation evidence
      "**/browser-vite-cache/**", // generated validation-browser dependencies, not authored source
      "src/dist/**",
      "*.min.js",
      "build/**",
      "src/**", // src has its own config
    ],
  },
  // Main process files (CommonJS)
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.commonjs,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Relaxed rules - catch syntax errors but don't be too strict
      "no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_|^event|^err|^error" },
      ],
      "no-console": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-control-regex": "off",
      "no-useless-catch": "off",
      "no-async-promise-executor": "off",
      "prefer-const": "off",
      "no-var": "off",
    },
  },
];
