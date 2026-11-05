import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node
    },
    rules: {
      // Allow intentionally unused parameters/variables when prefixed with "_".
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }
      ]
    }
  },
  {
    // Tests read loosely-typed JSON responses; `any` keeps assertions readable.
    files: ["test/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" }
  }
]);
