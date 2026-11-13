import { expect, test } from "bun:test";
import { objectKeys } from "ts-extras";
import { createPlugin } from "../src/index.ts";

test("should expose functions from the runtime entry and none from type entries", async () => {
    const [publicTypes, authorizationTypes] = await Promise.all([
        import("../src/types.ts"),
        import("../src/provider/types.ts"),
    ]);

    expect(createPlugin).toBeFunction();
    expect(objectKeys(publicTypes)).toEqual([]);
    expect(objectKeys(authorizationTypes)).toEqual([]);
});
