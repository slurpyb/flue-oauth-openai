import typefestPlugin from "eslint-plugin-typefest";
import pandaCss from "@pandacss/eslint-plugin"
import unicorn from 'eslint-plugin-unicorn'
import eslintPluginAstro from "eslint-plugin-astro"



export default [
    unicorn.configs.recommended,
    typefestPlugin.configs.recommended,
    ...eslintPluginAstro.configs.recommended,
   await pandaCss.configs.recommended({ configPath: './panda.config.ts' })
   ,

    // {
    //     ...eslintPluginAstro.configs.recommended,
    //     languageOptions: {
    //         parserOptions: {
    //             project: "./tsconfig.eslint.json",
    //         }
    //     }
    // },
    // {
    //     rules: {
    //         "astro/no-set-html-directive": "error"
    //     },
    // },
    {
        "settings": {
            "import/core-modules": ["astro:content", "astro:transitions"],
            "import/parsers": {
                "astro-eslint-parser": [".astro"],
                "espree": [".js", ".mjs", ".cjs"],
                "@typescript-eslint/parser": [".ts", ".tsx"]
            }
        }
    }
]