import { ESLint } from "eslint";
import fs from "fs";

const eslint = new ESLint();
const results = await eslint.lintFiles(["src/**/*.ts"]);
fs.writeFileSync("eslint-results.json", JSON.stringify(results, null, 2));
