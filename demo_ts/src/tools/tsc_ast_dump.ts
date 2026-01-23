import fs from "fs";
import path from "path";
import glob from "glob";
import ts from "typescript";

const projectRoot = process.cwd();
const files = glob.sync("src/**/*.ts", { absolute: true });
const outDir = path.join(projectRoot, "ast-dump");

fs.mkdirSync(outDir, { recursive: true });

// Custom serializer to handle TypeScript AST nodes
function serializeNode(node, sourceFile) {
  const obj = {
    kind: ts.SyntaxKind[node.kind],
    kindNum: node.kind,
    pos: node.pos,
    end: node.end,
  };

  // Add text for identifier-like nodes
  if (node.kind === ts.SyntaxKind.Identifier) {
    obj.text = node.text;
  }

  // Add flags if present
  if (node.flags) {
    obj.flags = node.flags;
  }

  // Add modifiers if present
  if (node.modifiers) {
    obj.modifiers = node.modifiers.map((m) => ts.SyntaxKind[m.kind]);
  }

  // Recursively serialize children
  const children = [];
  ts.forEachChild(node, (child) => {
    children.push(serializeNode(child, sourceFile));
  });

  if (children.length > 0) {
    obj.children = children;
  }

  return obj;
}

for (const filePath of files) {
  const code = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const ast = serializeNode(sourceFile, sourceFile);

  const relative = path
    .relative(projectRoot, filePath)
    .replace(/[\/\\]/g, "__");
  const outFile = path.join(outDir, relative + ".ast.json");
  fs.writeFileSync(outFile, JSON.stringify(ast, null, 2));
  console.log(`AST written: ${outFile}`);
}

console.log("All ASTs dumped to ast-dump/");
