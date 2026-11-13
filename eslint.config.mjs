import js from '@eslint/js';
import typefestPlugin from 'eslint-plugin-typefest';
import unicorn from 'eslint-plugin-unicorn';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/**', '.pi/**', '.agents/**']),
  js.configs.recommended,
  unicorn.configs.unopinionated,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [
      tseslint.configs.strictTypeChecked,
      typefestPlugin.configs.strict,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
