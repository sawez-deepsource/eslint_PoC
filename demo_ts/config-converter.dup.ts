// src/tools/config-converter.ts

import fs from "fs";

interface LegacyConfig {
  extends?: string[];
  parser?: string;
  parserOptions?: Record<string, any>;
  plugins?: string[];
  rules?: Record<string, any>;
}

export class ConfigConverter {
  static convert(legacyConfig: LegacyConfig) {
    const isTypeScript = this.usesTypeScript(legacyConfig);

    if (!isTypeScript) {
      throw new Error("Only TypeScript projects are supported in this PoC");
    }

    const source = this.generateTypeScriptConfig(legacyConfig);
    return { source };
  }

  private static usesTypeScript(config: LegacyConfig): boolean {
    return !!(
      config.parser?.includes("@typescript-eslint/parser") ||
      config.plugins?.includes("@typescript-eslint") ||
      config.extends?.some((e) => e.includes("@typescript-eslint"))
    );
  }

  private static generateTypeScriptConfig(config: LegacyConfig): string {
    // Build rules
    const rulesets: string[] = [];
    const extendsArray = config.extends || [];

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
    const userRules = Object.entries(config.rules || {}).map(
      ([key, value]) => `"${key}": ${JSON.stringify(value)}`,
    );

    const allRules = [...rulesets, ...userRules].join(",\n      ");

    // Parser options
    const parserOptions = config.parserOptions || {};
    const project = parserOptions.project || "./tsconfig.json";

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
    return JSON.parse(content);
  }

  static writeFlatConfig(source: string, outputPath: string): void {
    fs.writeFileSync(outputPath, source, "utf8");
  }
}
