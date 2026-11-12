import { defineConfig } from 'oxlint';
import core from '@fullsnacklab/oxlint-config';

export default defineConfig({
	extends: [core],
	// Archived vendor snapshots/examples are evidence, not application source.
	ignorePatterns: ['.agents/**', '.pi/**'],
});
