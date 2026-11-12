import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const STATE_TYPE = "rule-injector-state";

// Persist the content so resumed sessions don't depend on the original file.
function getRules(ctx: ExtensionContext): string | null {
  let rules: string | null = null;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== STATE_TYPE) {
      continue;
    }

    const data: unknown = entry.data;
    if (data === null || typeof data === "string") {
      rules = data;
    }
  }

  return rules;
}

function loadRules(path: string, cwd: string): string {
  const expanded = path.startsWith("~/")
    ? resolve(homedir(), path.slice(2))
    : resolve(cwd, path);

  const rules = readFileSync(expanded, "utf8")
    .replace(
      /^---[^\S\r\n]*\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/,
      "",
    )
    .trim();

  if (!rules) {
    throw new Error(`Rules file is empty: ${expanded}`);
  }

  return rules;
}

export default function ruleInjector(pi: ExtensionAPI) {
  pi.registerCommand("rules", {
    description: "Load a rules file, show status, or disable with /rules off",
    handler: async (args, ctx) => {
      const argument = args.trim();

      if (!argument) {
        ctx.ui.notify(
          getRules(ctx) === null ? "Rules are off." : "Rules are active.",
          "info",
        );
        return;
      }

      if (argument.toLowerCase() === "off") {
        pi.appendEntry(STATE_TYPE, null);
        ctx.ui.notify("Rules disabled.", "info");
        return;
      }

      try {
        const rules = loadRules(argument, ctx.cwd);
        pi.appendEntry(STATE_TYPE, rules);
        ctx.ui.notify(`Rules loaded: ${argument}`, "info");
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(reason, "error");
      }
    },
  });

  pi.on("before_agent_start", (event, ctx) => {
    const rules = getRules(ctx);
    if (rules === null) return;

    return {
      systemPrompt: `${event.systemPrompt}\n\n# Active user rules\n\n${rules}`,
    };
  });
}
