import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import { convertJsxSourceToSvelte } from "./ast-jsx-to-svelte.mjs";

// Recover a mount only when the entry itself identifies both its DOM anchor and component.
export function translateReactMount({ source, job, put }) {
  const load = (rel) => fs.readFileSync(path.join(source, rel), "utf8");
  const entry = parse(load(job.entry), {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const imports = entry.program.body.filter(
    (stmt) => stmt.type === "ImportDeclaration",
  );
  const client = imports.find(
    (stmt) => stmt.source.value === "react-dom/client",
  );
  if (!client) return null;
  const fail = (reason) => {
    throw Error("Unsupported recovered React mount: " + reason);
  };
  const factory = client.specifiers.find(
    (s) => s.imported?.name === "createRoot",
  )?.local.name;
  const statements = entry.program.body.filter(
    (stmt) => stmt.type !== "ImportDeclaration",
  );
  if (!factory || statements.length !== 1)
    fail("expected one root render call");
  const render = statements[0].expression;
  if (render?.callee?.property?.name !== "render")
    fail("expected createRoot(...).render(...)");
  const createRoot = render.callee.object;
  const lookup = createRoot?.arguments?.[0];
  if (
    createRoot.callee?.name !== factory ||
    lookup?.callee?.object.name !== "document" ||
    lookup.callee.property.name !== "getElementById" ||
    lookup.arguments[0]?.type !== "StringLiteral"
  )
    fail("unresolved DOM anchor");
  const jsx = render.arguments[0];
  if (
    jsx?.type !== "JSXElement" ||
    jsx.openingElement.attributes.length ||
    jsx.children.length
  )
    fail("expected one unconfigured root component");
  const binding = jsx.openingElement.name.name;
  const rootImport = imports.find((stmt) =>
    stmt.specifiers.some(
      (s) => s.type === "ImportDefaultSpecifier" && s.local.name === binding,
    ),
  );
  if (!rootImport || !rootImport.source.value.startsWith("."))
    fail("root component must be an identified local default export");
  const files = new Set(job.sources);
  const visited = new Set();
  const extensions = [
    "",
    ".js",
    ".ts",
    ".mjs",
    ".jsx",
    ".tsx",
    "/index.js",
    "/index.ts",
    "/index.jsx",
    "/index.tsx",
  ];
  function resolveImport(file, spec) {
    const base = path.posix.normalize(
      path.posix.join(path.posix.dirname(file), spec),
    );
    const match = extensions
      .map((ext) => base + ext)
      .find((rel) => files.has(rel));
    if (!match) fail("missing " + spec + " from " + file);
    return match;
  }
  function dest(file) {
    if (!file.startsWith("recovered-source/"))
      fail("missing authored path for " + file);
    return "src/lib/" + file.replace(/\.[jt]sx$/, ".svelte");
  }
  function translate(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const original = load(file);
    if (/\.[jt]sx$/.test(file)) {
      const component = convertJsxSourceToSvelte(original, {
        name: path.posix.basename(file).replace(/\.[^.]+$/, ""),
        resolveImport(spec) {
          if (!spec.startsWith(".")) return spec;
          const imported = resolveImport(file, spec);
          translate(imported);
          let rel = path.posix.relative(
            path.posix.dirname(dest(file)),
            dest(imported),
          );
          return rel.startsWith(".") ? rel : "./" + rel;
        },
      });
      if (!component) fail("unhandled JSX component " + file);
      put(dest(file), component);
    } else {
      put(dest(file), original);
      if (/\.[jt]s$|\.mjs$/.test(file)) {
        const ast = parse(original, {
          sourceType: "module",
          plugins: ["typescript"],
        });
        for (const stmt of ast.program.body)
          if (stmt.source?.value?.startsWith("."))
            translate(resolveImport(file, stmt.source.value));
      }
    }
  }
  const componentFile = resolveImport(job.entry, rootImport.source.value);
  if (!/\.[jt]sx$/.test(componentFile)) fail("component must use JSX or TSX");
  for (const stmt of imports) {
    if (stmt === client || stmt === rootImport || stmt.source.value === "react")
      continue;
    fail("entry contains extra import " + stmt.source.value);
  }
  translate(componentFile);
  return {
    id: lookup.arguments[0].value,
    component: dest(componentFile).slice("src/lib/".length),
  };
}
