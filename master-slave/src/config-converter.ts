// src/config-converter.ts - Legacy to Flat config converter

import fs from "fs";

type RuleValue = string | number | unknown[] | Record<string, unknown>;

export interface LegacyConfig {
  extends?: string[];
  parser?: string;
  parserOptions?: {
    project?: string;
    sourceType?: string;
    [key: string]: unknown;
  };
  plugins?: string[];
  rules?: Record<string, RuleValue>;
}

export class ConfigConverter {
  static convert(legacyConfig: LegacyConfig): { source: string } {
    const isTypeScript = this.usesTypeScript(legacyConfig);

    if (!isTypeScript) {
      throw new Error("Only TypeScript projects are supported in this PoC");
    }

    const source = this.generateTypeScriptConfig(legacyConfig);
    return { source };
  }

  private static usesTypeScript(config: LegacyConfig): boolean {
    const hasParser =
      config.parser?.includes("@typescript-eslint/parser") === true;
    const hasPlugin = config.plugins?.includes("@typescript-eslint") === true;
    const hasExtends =
      config.extends?.some((e) => e.includes("@typescript-eslint")) === true;
    return hasParser || hasPlugin || hasExtends;
  }

  private static generateTypeScriptConfig(config: LegacyConfig): string {
    // Build rules
    const rulesets: string[] = [];
    const extendsArray = config.extends ?? [];

    if (extendsArray.includes("plugin:@typescript-eslint/recommended")) {
      rulesets.push("...tsPlugin.configs.recommended.rules");
    }

    if (
      extendsArray.some(
        (e) =>
          e.includes("recommended-requiring-type-checking") ||
          e.includes("recommended-type-checked"),
      )
    ) {
      rulesets.push(
        "...tsPlugin.configs['recommended-requiring-type-checking'].rules",
      );
    }

    // User custom rules
    const userRules = Object.entries(config.rules ?? {}).map(
      ([key, value]) => `"${key}": ${JSON.stringify(value)}`,
    );

    const allRules = [...rulesets, ...userRules].join(",\n      ");

    // Parser options
    const parserOptions = config.parserOptions ?? {};
    const project = parserOptions.project ?? "./tsconfig.json";

    return `import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default [
  {
    ignores: ["eslint.config.mjs", "dist/**", "node_modules/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ${JSON.stringify(project)},
        tsconfigRootDir: __dirname,
      },
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ${allRules}
    },
  },
];`;
  }

  static loadLegacyConfig(configPath: string): LegacyConfig {
    const content = fs.readFileSync(configPath, "utf8");
    return JSON.parse(content) as LegacyConfig;
  }

  static writeFlatConfig(source: string, outputPath: string): void {
    fs.writeFileSync(outputPath, source, "utf8");
  }
}
