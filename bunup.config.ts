import type { DefineConfigItem } from "bunup";

const config: DefineConfigItem = {
    entry: "src/index.ts",
    dts: { entry: "src/types.ts" },
    exports: {
        includePackageJson: true
    }
};

export default config;
