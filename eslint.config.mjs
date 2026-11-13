import typefestPlugin from 'eslint-plugin-typefest';
import unicorn from 'eslint-plugin-unicorn';

export default [
  { ignores: ['dist/**', '.pi/**', '.agents/**'] },
  unicorn.configs.recommended,
  typefestPlugin.configs.recommended
];
