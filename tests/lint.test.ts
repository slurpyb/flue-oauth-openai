import { expect, test } from "bun:test";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";

const eslint = new ESLint();
const filePath = fileURLToPath(new URL("../src/plugin/index.ts", import.meta.url));

test("should reject floating promises under the configured lint policy", async () => {
    const [result] = await eslint.lintText(
        "export async function work() { await Promise.resolve(); } work();",
        { filePath },
    );

    expect(result?.fatalErrorCount).toBe(0);
    expect(result?.messages.some((message) =>
        message.ruleId === "@typescript-eslint/no-floating-promises")).toBe(true);
}, 15_000);

test("should reject unsafe JSON assignments under the configured lint policy", async () => {
    const [result] = await eslint.lintText(
        "export const value: string = JSON.parse('1');",
        { filePath },
    );

    expect(result?.fatalErrorCount).toBe(0);
    expect(result?.messages.some((message) =>
        message.ruleId === "@typescript-eslint/no-unsafe-assignment")).toBe(true);
}, 15_000);

test("should accept valid code under the configured lint policy", async () => {
    const [result] = await eslint.lintText(
        'export const value = "ready";',
        { filePath },
    );

    expect(result?.fatalErrorCount).toBe(0);
    expect(result?.errorCount).toBe(0);
    expect(result?.warningCount).toBe(0);
}, 15_000);
