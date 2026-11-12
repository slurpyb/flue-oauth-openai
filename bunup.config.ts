import { defineConfig } from 'bunup';

// https://bunup.dev/docs/guide/workspaces

export default defineConfig({
	entry: 'src/index.ts',
	dts: { 
		entry: 'src/types.ts'
	},
	exports: {
		includePackageJson: true
	}
})
