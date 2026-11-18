#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import * as parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';
import { webcrack } from 'webcrack';
import postcss from 'postcss';
import prettier from 'prettier';

const traverse = traverseModule.default || traverseModule;
const generate = generateModule.default || generateModule;

const SINGLE_LETTERS = new Set([
  'e', 't', 'n', 'r', 'o', 'i', 'a', 's', 'c', 'l', 'u', 'd', 'p', 'f', 'g', 'h', 'm', 'v', 'w', 'x', 'y', 'z'
]);

const BANNED_SYNTHETIC_NAMES = new Set([
  'elem',
  'nextVal',
  'prevVal',
  'localValue',
  'moduleLocal',
  'target2',
  'target3',
  'target4'
]);

const FLIP_RELATIONAL = {
  '<': '>',
  '<=': '>=',
  '>': '<',
  '>=': '<='
};

function isSimpleLiteralLike(node) {
  return (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    t.isIdentifier(node, { name: 'undefined' })
  );
}

function toCamelCase(rawText, fallback = 'nodeRef') {
  const tokens = String(rawText || '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return fallback;
  const slice = tokens.slice(-2);
  const candidate = slice
    .map((word, idx) =>
      idx === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join('');
  return /^[a-zA-Z_$]/.test(candidate) ? candidate : `${fallback}${candidate}`;
}

function isRollupNamespaceWrapper(node) {
  if (
    !t.isCallExpression(node) ||
    !t.isMemberExpression(node.callee) ||
    !t.isIdentifier(node.callee.object, { name: 'Object' }) ||
    !t.isIdentifier(node.callee.property, { name: 'freeze' }) ||
    node.arguments.length !== 1
  ) {
    return null;
  }
  const inner = node.arguments[0];
  if (
    !t.isCallExpression(inner) ||
    !t.isMemberExpression(inner.callee) ||
    !t.isIdentifier(inner.callee.object, { name: 'Object' }) ||
    !t.isIdentifier(inner.callee.property, { name: 'defineProperty' }) ||
    inner.arguments.length < 3 ||
    !t.isObjectExpression(inner.arguments[0])
  ) {
    return null;
  }
  const objExpr = inner.arguments[0];
  const tagArg = inner.arguments[1];
  const isToStringTag =
    t.isMemberExpression(tagArg) &&
    t.isIdentifier(tagArg.object, { name: 'Symbol' }) &&
    t.isIdentifier(tagArg.property, { name: 'toStringTag' });
  if (!isToStringTag) return null;

  const cleanProps = objExpr.properties.filter(
    (prop) =>
      !(
        t.isObjectProperty(prop) &&
        t.isIdentifier(prop.key, { name: '__proto__' }) &&
        t.isNullLiteral(prop.value)
      )
  );
  return t.objectExpression(cleanProps);
}

function isLastStatementInBlock(stmtPath) {
  const parent = stmtPath.parentPath;
  if (!parent || !parent.isBlockStatement()) return false;
  const body = parent.node.body;
  return body.length > 0 && body[body.length - 1] === stmtPath.node;
}

/**
 * Infers domain-meaningful identifier names by inspecting BOTH declaration initializers
 * AND all reference usage sites (member properties, method calls, JSX attributes).
 * Never emits banned AST placeholder tokens.
 */
function inferSemanticBindingName(name, binding) {
  // 1. Inspect reference sites first for rich domain clues
  const accessedProps = new Set();
  for (const refPath of binding.referencePaths || []) {
    const parent = refPath.parent;
    if (t.isMemberExpression(parent) && parent.object === refPath.node && t.isIdentifier(parent.property)) {
      accessedProps.add(parent.property.name);
    }
    if (t.isJSXOpeningElement(parent) && parent.name === refPath.node) {
      return 'DynamicElement';
    }
  }

  if (accessedProps.has('preventDefault') || accessedProps.has('stopPropagation') || accessedProps.has('currentTarget')) {
    return 'domEvent';
  }
  if (accessedProps.has('querySelector') || accessedProps.has('classList') || accessedProps.has('getBoundingClientRect')) {
    return 'containerEl';
  }
  if (accessedProps.has('currentTime') || accessedProps.has('readyState') || accessedProps.has('paused')) {
    return 'mediaEl';
  }
  if (accessedProps.has('clearRect') || accessedProps.has('fillRect') || accessedProps.has('drawImage')) {
    return 'canvasCtx';
  }
  if (accessedProps.has('useProgram') || accessedProps.has('uniform1f') || accessedProps.has('drawArrays')) {
    return 'glContext';
  }
  if (accessedProps.has('isIntersecting') || accessedProps.has('intersectionRatio')) {
    return 'observerEntry';
  }
  if (accessedProps.has('className') || accessedProps.has('children')) {
    return 'componentProps';
  }
  if (accessedProps.has('current') && accessedProps.size === 1) {
    return 'mutableRef';
  }

  // 2. Parameter context
  if (binding.kind === 'param') {
    const fn = binding.path.parent;
    if (t.isFunction(fn)) {
      const paramIdx = fn.params.findIndex((p) => t.isIdentifier(p) && p.name === name);
      const parentCall = binding.path.parentPath?.parent;
      const calleeProp =
        parentCall && t.isCallExpression(parentCall) && t.isMemberExpression(parentCall.callee)
          ? parentCall.callee.property
          : null;
      if (t.isIdentifier(calleeProp)) {
        if (calleeProp.name === 'addEventListener' && paramIdx === 0) return 'domEvent';
        if (['forEach', 'map', 'filter', 'find', 'some', 'every'].includes(calleeProp.name)) {
          if (paramIdx === 0) return 'record';
          if (paramIdx === 1) return 'index';
          if (paramIdx === 2) return 'records';
        }
        if (calleeProp.name === 'reduce') {
          if (paramIdx === 0) return 'accumulator';
          if (paramIdx === 1) return 'currentRecord';
          if (paramIdx === 2) return 'index';
        }
        if (calleeProp.name === 'then' && paramIdx === 0) return 'resolvedPayload';
        if (calleeProp.name === 'catch' && paramIdx === 0) return 'caughtError';
      }
      if (t.isFunctionDeclaration(fn) && fn.id && /^[A-Z]/.test(fn.id.name) && paramIdx === 0) {
        return 'props';
      }
      const semanticParams = ['inputValue', 'secondInput', 'configOptions', 'executionContext', 'extraOptions'];
      return semanticParams[paramIdx] || `parameter${paramIdx + 1}`;
    }
  }

  if (binding.path.isCatchClause()) {
    return 'caughtError';
  }

  // 3. Variable declarator initializer inspection
  if (binding.path.isVariableDeclarator()) {
    const init = binding.path.node.init;
    if (init) {
      if (t.isStringLiteral(init)) return 'labelText';
      if (t.isNumericLiteral(init)) return 'numericOffset';
      if (t.isBooleanLiteral(init)) return 'isActiveFlag';
      if (t.isArrayExpression(init)) return 'itemsList';
      if (t.isObjectExpression(init)) return 'stateConfig';

      if (t.isCallExpression(init)) {
        if (t.isIdentifier(init.callee)) {
          const fnName = init.callee.name;
          if (fnName === 'useRef') return 'elementRef';
          if (fnName === 'useId') return 'generatedId';
          if (fnName === 'useRouter') return 'routerInstance';
          if (fnName === 'usePathname') return 'currentPathname';
          if (fnName === 'requestAnimationFrame') return 'frameHandle';
          if (fnName === 'setTimeout' || fnName === 'setInterval') return 'timerHandle';
        }
        if (t.isMemberExpression(init.callee) && t.isIdentifier(init.callee.property)) {
          const prop = init.callee.property.name;
          if (prop === 'querySelector' || prop === 'getElementById') {
            const firstArg = init.arguments[0];
            if (firstArg && t.isStringLiteral(firstArg)) {
              return `${toCamelCase(firstArg.value, 'dom')}El`;
            }
            return 'selectedEl';
          }
          if (prop === 'querySelectorAll') {
            const firstArg = init.arguments[0];
            if (firstArg && t.isStringLiteral(firstArg)) {
              return `${toCamelCase(firstArg.value, 'dom')}NodeList`;
            }
            return 'matchedNodes';
          }
          if (prop === 'getContext') {
            const firstArg = init.arguments[0];
            return firstArg && t.isStringLiteral(firstArg) && firstArg.value === '2d' ? 'ctx2d' : 'glCtx';
          }
          if (prop === 'getBoundingClientRect') return 'layoutRect';
          if (prop === 'getComputedStyle') return 'computedStyle';
          if (prop === 'timeline') return 'motionTimeline';
          if (prop === 'createElement' && t.isStringLiteral(init.arguments[0])) {
            return `${toCamelCase(init.arguments[0].value, 'created')}El`;
          }
          if (prop === 'matchMedia') return 'mediaQueryList';
        }
      } else if (t.isNewExpression(init) && t.isIdentifier(init.callee)) {
        const clsName = init.callee.name;
        if (clsName === 'IntersectionObserver') return 'intersectionObserver';
        if (clsName === 'ResizeObserver') return 'resizeObserver';
        if (clsName === 'MutationObserver') return 'mutationObserver';
        if (clsName === 'AbortController') return 'abortController';
        if (clsName === 'Map') return 'registryMap';
        if (clsName === 'Set') return 'visitedSet';
        return clsName.charAt(0).toLowerCase() + clsName.slice(1) + 'Instance';
      } else if (t.isMemberExpression(init) && t.isIdentifier(init.property)) {
        return toCamelCase(init.property.name, 'extractedField');
      }
    }
  }

  const parentFor = binding.path.findParent((p) => p.isForStatement());
  if (parentFor) return 'loopIndex';

  return 'computedState';
}

/**
 * Converts compiled React JSX runtime calls:
 *   (0, jsxRuntime.jsx)("div", { className: "hero", children: "Hi" }, key)
 *   React.createElement("span", { id: "x" }, child1, child2)
 * back into clean, human-readable AST JSXElement / JSXFragment nodes!
 */
export function convertCompiledJsxCallsInAst(ast) {
  function exprToJsxChild(node) {
    if (!node || t.isNullLiteral(node) || t.isBooleanLiteral(node) || t.isIdentifier(node, { name: 'undefined' })) {
      return [];
    }
    if (t.isStringLiteral(node)) {
      if (!node.value.includes('{') && !node.value.includes('}') && !node.value.includes('<') && !node.value.includes('>')) {
        return [t.jsxText(node.value)];
      }
      return [t.jsxExpressionContainer(node)];
    }
    if (t.isJSXElement(node) || t.isJSXFragment(node)) {
      return [node];
    }
    if (t.isArrayExpression(node)) {
      const out = [];
      for (const el of node.elements) {
        if (el && !t.isSpreadElement(el)) out.push(...exprToJsxChild(el));
      }
      return out;
    }
    return [t.jsxExpressionContainer(node)];
  }

  function tagExprToJsxName(tagNode) {
    if (t.isStringLiteral(tagNode)) {
      return /^[a-zA-Z_$][a-zA-Z0-9_$-]*$/.test(tagNode.value) ? t.jsxIdentifier(tagNode.value) : null;
    }
    if (t.isIdentifier(tagNode)) {
      return t.jsxIdentifier(tagNode.name);
    }
    if (t.isMemberExpression(tagNode) && !tagNode.computed && t.isIdentifier(tagNode.object) && t.isIdentifier(tagNode.property)) {
      return t.jsxMemberExpression(t.jsxIdentifier(tagNode.object.name), t.jsxIdentifier(tagNode.property.name));
    }
    return null;
  }

  traverse(ast, {
    CallExpression: {
      exit(astPath) {
        let callee = astPath.node.callee;
        if (t.isSequenceExpression(callee) && callee.expressions.length === 2 && t.isNumericLiteral(callee.expressions[0], { value: 0 })) {
          callee = callee.expressions[1];
        }

        let isJsxRuntime = false;
        let isFragmentHelper = false;
        let isCreateElement = false;

        if (t.isIdentifier(callee)) {
          if (['jsx', 'jsxs', 'jsxDEV', '_jsx', '_jsxs'].includes(callee.name)) isJsxRuntime = true;
        } else if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
          const propName = callee.property.name;
          if (['jsx', 'jsxs', 'jsxDEV'].includes(propName)) isJsxRuntime = true;
          else if (propName === 'createElement') isCreateElement = true;
        }

        if (!isJsxRuntime && !isCreateElement) return;
        const [tagArg, propsArg, thirdArg] = astPath.node.arguments;
        if (!tagArg) return;

        // Check Fragment
        if (
          (t.isIdentifier(tagArg) && (tagArg.name === 'Fragment' || tagArg.name.endsWith('Fragment'))) ||
          (t.isMemberExpression(tagArg) && t.isIdentifier(tagArg.property, { name: 'Fragment' }))
        ) {
          isFragmentHelper = true;
        }

        const jsxAttrs = [];
        let childrenNodes = [];

        if (propsArg && t.isObjectExpression(propsArg)) {
          for (const prop of propsArg.properties) {
            if (t.isSpreadElement(prop)) {
              jsxAttrs.push(t.jsxSpreadAttribute(prop.argument));
              continue;
            }
            if (!t.isObjectProperty(prop) || prop.computed) continue;
            const rawKey = t.isIdentifier(prop.key)
              ? prop.key.name
              : t.isStringLiteral(prop.key)
                ? prop.key.value
                : null;
            if (!rawKey) continue;

            if (rawKey === 'children') {
              childrenNodes.push(...exprToJsxChild(prop.value));
              continue;
            }
            if (!/^[a-zA-Z_:][a-zA-Z0-9_.:-]*$/.test(rawKey)) continue;

            // WAI-ARIA safety: omit aria-hidden="true" on <a>
            if (rawKey === 'aria-hidden' && t.isStringLiteral(tagArg, { value: 'a' })) {
              continue;
            }

            const attrId = t.jsxIdentifier(rawKey);
            if (t.isStringLiteral(prop.value)) {
              jsxAttrs.push(t.jsxAttribute(attrId, prop.value));
            } else if (t.isBooleanLiteral(prop.value, { value: true })) {
              jsxAttrs.push(t.jsxAttribute(attrId, null));
            } else {
              jsxAttrs.push(t.jsxAttribute(attrId, t.jsxExpressionContainer(prop.value)));
            }
          }
        } else if (propsArg && !t.isNullLiteral(propsArg) && !t.isIdentifier(propsArg, { name: 'undefined' })) {
          jsxAttrs.push(t.jsxSpreadAttribute(propsArg));
        }

        if (isJsxRuntime && thirdArg && !t.isIdentifier(thirdArg, { name: 'undefined' })) {
          jsxAttrs.push(
            t.jsxAttribute(
              t.jsxIdentifier('key'),
              t.isStringLiteral(thirdArg) ? thirdArg : t.jsxExpressionContainer(thirdArg)
            )
          );
        }

        if (isCreateElement && astPath.node.arguments.length > 2) {
          for (const extraChild of astPath.node.arguments.slice(2)) {
            if (!t.isSpreadElement(extraChild)) {
              childrenNodes.push(...exprToJsxChild(extraChild));
            }
          }
        }

        if (isFragmentHelper && jsxAttrs.length === 0) {
          astPath.replaceWith(t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), childrenNodes));
          return;
        }

        const jsxName = isFragmentHelper ? t.jsxIdentifier('Fragment') : tagExprToJsxName(tagArg);
        if (!jsxName) return;

        const selfClosing = childrenNodes.length === 0;
        const opening = t.jsxOpeningElement(jsxName, jsxAttrs, selfClosing);
        const closing = selfClosing ? null : t.jsxClosingElement(t.cloneNode(jsxName));
        astPath.replaceWith(t.jsxElement(opening, closing, childrenNodes, selfClosing));
      }
    }
  });
}

export async function humanizeJavaScript(sourceCode, options = {}) {
  let code = sourceCode;

  try {
    const cracked = await webcrack(code, {
      jsx: options.jsx ?? true,
      deobfuscate: true,
      unminify: true
    });
    code = cracked.code;
  } catch { }

  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    });
  } catch {
    try {
      ast = parser.parse(code, { sourceType: 'script', plugins: ['jsx'] });
    } catch {
      return code;
    }
  }

  // First reconstruct real JSX elements from any compiled jsx()/jsxs()/createElement() calls
  convertCompiledJsxCallsInAst(ast);

  // Multi-pass sequence unrolling & idiom normalization
  for (let pass = 0; pass < 3; pass++) {
    traverse(ast, {
      CallExpression: {
        enter(astPath) {
          const callee = astPath.node.callee;
          if (t.isSequenceExpression(callee) && callee.expressions.length === 2) {
            if (t.isNumericLiteral(callee.expressions[0], { value: 0 })) {
              astPath.node.callee = callee.expressions[1];
            }
          }
          const unwrappedModule = isRollupNamespaceWrapper(astPath.node);
          if (unwrappedModule) {
            astPath.replaceWith(unwrappedModule);
            return;
          }
          if (
            (t.isIdentifier(astPath.node.callee, { name: 'definePublicField' }) ||
              t.isIdentifier(astPath.node.callee, { name: 'defineNormalField' })) &&
            astPath.node.arguments.length === 3 &&
            t.isStringLiteral(astPath.node.arguments[1])
          ) {
            const [targetObj, propLiteral, valueExpr] = astPath.node.arguments;
            const propId = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(propLiteral.value)
              ? t.memberExpression(targetObj, t.identifier(propLiteral.value))
              : t.memberExpression(targetObj, propLiteral, true);
            astPath.replaceWith(t.assignmentExpression('=', propId, valueExpr));
          }

          // Unroll sequence expressions in call arguments
          const stmtParent = astPath.getStatementParent();
          if (stmtParent && !stmtParent.isLoop()) {
            for (let i = 0; i < astPath.node.arguments.length; i++) {
              const arg = astPath.node.arguments[i];
              if (t.isSequenceExpression(arg)) {
                const exprs = arg.expressions;
                const prefix = exprs.slice(0, -1).map((e) => t.expressionStatement(e));
                astPath.node.arguments[i] = exprs[exprs.length - 1];
                stmtParent.insertBefore(prefix);
              }
            }
          }
        }
      },

      SpreadElement(astPath) {
        if (t.isSequenceExpression(astPath.node.argument)) {
          const stmtParent = astPath.getStatementParent();
          if (stmtParent && !stmtParent.isLoop()) {
            const exprs = astPath.node.argument.expressions;
            const prefix = exprs.slice(0, -1).map((e) => t.expressionStatement(e));
            astPath.node.argument = exprs[exprs.length - 1];
            stmtParent.insertBefore(prefix);
          }
        }
      },

      ArrowFunctionExpression(astPath) {
        const body = astPath.node.body;
        if (t.isUnaryExpression(body, { operator: 'void' })) {
          const inner = body.argument;
          const stmts = t.isSequenceExpression(inner)
            ? inner.expressions.map((e) => t.expressionStatement(e))
            : [t.expressionStatement(inner)];
          astPath.node.body = t.blockStatement(stmts);
        } else if (t.isSequenceExpression(body)) {
          const exprs = body.expressions;
          const stmts = exprs.slice(0, -1).map((e) => t.expressionStatement(e));
          stmts.push(t.returnStatement(exprs[exprs.length - 1]));
          astPath.node.body = t.blockStatement(stmts);
        }
      },

      ExpressionStatement: {
        exit(astPath) {
          const expr = astPath.node.expression;
          if (t.isUnaryExpression(expr, { operator: 'void' })) {
            astPath.node.expression = expr.argument;
            return;
          }
          if (t.isSequenceExpression(expr)) {
            astPath.replaceWithMultiple(expr.expressions.map((item) => t.expressionStatement(item)));
            return;
          }
          if (t.isLogicalExpression(expr) && (expr.operator === '&&' || expr.operator === '||')) {
            const test = expr.operator === '&&' ? expr.left : t.unaryExpression('!', expr.left);
            astPath.replaceWith(t.ifStatement(test, t.blockStatement([t.expressionStatement(expr.right)])));
            return;
          }
          if (
            t.isConditionalExpression(expr) &&
            (t.isSequenceExpression(expr.consequent) || t.isSequenceExpression(expr.alternate))
          ) {
            const toBlock = (arm) =>
              t.blockStatement(
                t.isSequenceExpression(arm)
                  ? arm.expressions.map((e) => t.expressionStatement(e))
                  : [t.expressionStatement(arm)]
              );
            astPath.replaceWith(t.ifStatement(expr.test, toBlock(expr.consequent), toBlock(expr.alternate)));
          }
        }
      },

      ReturnStatement(astPath) {
        const arg = astPath.node.argument;
        if (!arg) return;
        if (t.isUnaryExpression(arg, { operator: 'void' })) {
          const inner = arg.argument;
          const stmts = t.isSequenceExpression(inner)
            ? inner.expressions.map((e) => t.expressionStatement(e))
            : [t.expressionStatement(inner)];
          if (!isLastStatementInBlock(astPath)) {
            stmts.push(t.returnStatement(null));
          }
          astPath.replaceWithMultiple(stmts);
        } else if (t.isSequenceExpression(arg)) {
          const exprs = arg.expressions;
          const prefix = exprs.slice(0, -1).map((e) => t.expressionStatement(e));
          astPath.replaceWithMultiple([...prefix, t.returnStatement(exprs[exprs.length - 1])]);
        }
      },

      IfStatement(astPath) {
        if (t.isSequenceExpression(astPath.node.test)) {
          const exprs = astPath.node.test.expressions;
          const prefix = exprs.slice(0, -1).map((e) => t.expressionStatement(e));
          astPath.node.test = exprs[exprs.length - 1];
          astPath.insertBefore(prefix);
        }
      },

      VariableDeclaration(astPath) {
        if (astPath.parentPath.isForStatement()) return;
        for (const decl of astPath.node.declarations) {
          if (decl.init && t.isSequenceExpression(decl.init)) {
            const exprs = decl.init.expressions;
            const prefix = exprs.slice(0, -1).map((e) => t.expressionStatement(e));
            decl.init = exprs[exprs.length - 1];
            astPath.insertBefore(prefix);
          }
        }
      },

      StringLiteral(astPath) {
        const val = astPath.node.value;
        if (
          val.length > 170 &&
          val.includes(' ') &&
          !astPath.parentPath.isImportDeclaration() &&
          !astPath.parentPath.isExportNamedDeclaration()
        ) {
          const parts = [];
          const words = val.split(' ');
          let curr = '';
          for (const w of words) {
            if ((curr + ' ' + w).length > 90 && curr) {
              parts.push(curr);
              curr = w;
            } else {
              curr = curr ? curr + ' ' + w : w;
            }
          }
          if (curr) parts.push(curr);
          if (parts.length > 1) {
            const arrExpr = t.arrayExpression(parts.map((p) => t.stringLiteral(p)));
            const joinCall = t.callExpression(
              t.memberExpression(arrExpr, t.identifier('join')),
              [t.stringLiteral(' ')]
            );
            astPath.replaceWith(joinCall);
          }
        }
      },

      UnaryExpression(astPath) {
        if (astPath.node.operator === '!' && t.isNumericLiteral(astPath.node.argument)) {
          astPath.replaceWith(t.booleanLiteral(astPath.node.argument.value === 0));
        } else if (astPath.node.operator === 'void') {
          if (t.isNumericLiteral(astPath.node.argument, { value: 0 })) {
            astPath.replaceWith(t.identifier('undefined'));
          } else if (!astPath.parentPath.isExpressionStatement()) {
            // Convert nested `void fn()` in expressions into `(() => { fn(); return undefined; })()` or unwrap
            astPath.replaceWith(
              t.callExpression(
                t.arrowFunctionExpression(
                  [],
                  t.blockStatement([t.expressionStatement(astPath.node.argument)])
                ),
                []
              )
            );
          }
        }
      },

      BinaryExpression(astPath) {
        const { operator, left, right } = astPath.node;
        if (!isSimpleLiteralLike(left) || isSimpleLiteralLike(right)) return;
        if (['===', '!==', '==', '!='].includes(operator)) {
          astPath.node.left = right;
          astPath.node.right = left;
        } else if (FLIP_RELATIONAL[operator]) {
          astPath.node.operator = FLIP_RELATIONAL[operator];
          astPath.node.left = right;
          astPath.node.right = left;
        }
      },

      JSXElement(astPath) {
        const opening = astPath.node.openingElement;
        if (t.isJSXIdentifier(opening.name) && opening.name.name === 'a') {
          opening.attributes = opening.attributes.filter((attr) => {
            if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'aria-hidden') {
              return false;
            }
            return true;
          });
        }
      }
    });
  }

  // Scope-safe semantic identifier renaming
  traverse(ast, {
    Scope(astPath) {
      const scope = astPath.scope;
      for (const name of Object.keys(scope.bindings)) {
        const binding = scope.bindings[name];
        const inForHeader = Boolean(binding.path.findParent((p) => p.isForStatement()));
        if (inForHeader && ['i', 'j', 'k'].includes(name)) continue;

        const needsRename =
          SINGLE_LETTERS.has(name) ||
          BANNED_SYNTHETIC_NAMES.has(name) ||
          /^_(?:inline|exp|submod|cjsDefaultExport)/.test(name) ||
          name.startsWith('Comp_') ||
          /^(?:var|param|target|elem|entry|item|factor|ratio|bound|localValue|moduleLocal)_?\d*$/.test(name);

        if (!needsRename) continue;

        let baseName = inferSemanticBindingName(name, binding);
        if (BANNED_SYNTHETIC_NAMES.has(baseName)) baseName = 'domainState';

        const suffixes = ['', 'Primary', 'Secondary', 'Tertiary', 'Alt', 'Next', 'Final'];
        let candidate = baseName;
        let idx = 0;
        while (
          scope.hasBinding(candidate, true) ||
          scope.hasGlobal(candidate) ||
          Boolean(scope.references?.[candidate])
        ) {
          idx++;
          candidate = idx < suffixes.length ? `${baseName}${suffixes[idx]}` : `${baseName}Ref${idx}`;
        }
        if (candidate !== name) {
          scope.rename(name, candidate);
        }
      }
    }
  });

  const generated = generate(ast, {
    retainLines: false,
    compact: false,
    concise: false
  });

  try {
    return await prettier.format(generated.code, {
      parser: 'babel',
      printWidth: 100,
      singleQuote: true,
      trailingComma: 'none'
    });
  } catch {
    return generated.code;
  }
}

/**
 * Finds balanced element span `[openStart, closeEnd]` starting from an opening `<tag ...>` at `startIdx`.
 */
function findBalancedElementEnd(html, startIdx, tagName) {
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  if (voidTags.has(tagName.toLowerCase())) {
    const endGt = html.indexOf('>', startIdx);
    return endGt === -1 ? -1 : endGt + 1;
  }
  const tagRe = new RegExp(`<(/?)(${tagName})\\b[^>]*>`, 'gi');
  tagRe.lastIndex = startIdx;
  let depth = 0;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const isClose = m[1] === '/';
    const selfClose = m[0].endsWith('/>');
    if (!isClose) {
      if (!selfClose) depth++;
      else if (depth === 0) return m.index + m[0].length;
    } else {
      depth--;
      if (depth <= 0) return m.index + m[0].length;
    }
  }
  return -1;
}

export async function formatSafeHtml(html) {
  const repaired = html.replace(
    /<(img|input|meta|link|source|br|hr)\b([^>]*?)"\/\s+([^>]*?)>/gi,
    '<$1$2" $3/>'
  );

  // Protect <pre>, <textarea>, and whitespace-pre* elements verbatim so Prettier never collapses \n or injects >><pre
  const protectedSlices = [];
  let protectedHtml = repaired;
  const rawTagPatterns = [
    /<(pre|textarea)\b[^>]*>/gi,
    /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*class=["'][^"']*\bwhitespace-(?:pre(?:-line|-wrap)?|break-spaces)\b[^"']*["'][^>]*>/gi
  ];

  for (const pat of rawTagPatterns) {
    let offset = 0;
    let output = '';
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(protectedHtml)) !== null) {
      if (m.index < offset) continue;
      const endIdx = findBalancedElementEnd(protectedHtml, m.index, m[1]);
      if (endIdx === -1) continue;
      const slice = protectedHtml.slice(m.index, endIdx);
      const token = `<!--__AGY_RAW_BLK_${protectedSlices.length}__-->`;
      protectedSlices.push(slice);
      output += protectedHtml.slice(offset, m.index) + token;
      offset = endIdx;
      pat.lastIndex = endIdx;
    }
    output += protectedHtml.slice(offset);
    protectedHtml = output;
  }

  let formatted = protectedHtml;
  try {
    formatted = await prettier.format(protectedHtml, {
      parser: 'html',
      htmlWhitespaceSensitivity: 'strict',
      printWidth: 120
    });
  } catch {
    formatted = protectedHtml;
  }

  return formatted.replace(/<!--__AGY_RAW_BLK_(\d+)__-->/g, (_, idxStr) => {
    const idx = Number(idxStr);
    return protectedSlices[idx] ?? '';
  });
}

export function sanitizeAndFormatCss(rawCss) {
  const cleaned = rawCss.replace(/@charset\s+["'][^"']+["']\s*;/gi, '');

  let root;
  try {
    root = postcss.parse(cleaned);
  } catch {
    return cleaned;
  }

  root.walkRules((rule) => {
    let hasDisplayBlock = false;
    let hasAppearance = false;
    let hasUserSelect = false;
    let hasTransform = false;
    let hasWebkitTap = false;

    rule.walkDecls((decl) => {
      const val = decl.value.trim();
      if (decl.prop === 'display' && val === 'block') hasDisplayBlock = true;
      if (decl.prop === 'appearance') hasAppearance = true;
      if (decl.prop === 'user-select') hasUserSelect = true;
      if (decl.prop === 'transform') hasTransform = true;
      if (decl.prop === '-webkit-tap-highlight-color') hasWebkitTap = true;
    });

    const declsToAdd = [];
    const declsToRemove = [];

    rule.walkDecls((decl) => {
      if (decl.value.includes('url(data:') || decl.value.includes('url("data:') || decl.value.includes("url('data:")) {
        decl.value = decl.value.replace(/url\(\s*['"]?(data:[^)]+?)['"]?\s*\)/gi, (_, dataPayload) => {
          const singleLineData = dataPayload.replace(/\s+/g, '');
          return `url("${singleLineData}")`;
        });
      }

      if (decl.prop === 'speak') {
        declsToRemove.push(decl);
      }

      if (decl.prop === 'tap-highlight-color') {
        if (!hasWebkitTap) {
          decl.prop = '-webkit-tap-highlight-color';
          hasWebkitTap = true;
        } else {
          declsToRemove.push(decl);
        }
      }

      if (decl.prop === 'vertical-align' && hasDisplayBlock) {
        declsToRemove.push(decl);
      }

      if (!rule.selector.includes('::-webkit-') && !rule.selector.includes('::-moz-')) {
        if (decl.prop === '-webkit-appearance' && !hasAppearance) {
          declsToAdd.push({ prop: 'appearance', value: decl.value });
          hasAppearance = true;
        }
        if (decl.prop === '-webkit-user-select' && !hasUserSelect) {
          declsToAdd.push({ prop: 'user-select', value: decl.value });
          hasUserSelect = true;
        }
        if (decl.prop === '-webkit-transform' && !hasTransform) {
          declsToAdd.push({ prop: 'transform', value: decl.value });
          hasTransform = true;
        }
      }
    });

    for (const d of declsToRemove) d.remove();
    for (const a of declsToAdd) rule.append(a);
  });

  // Recursively format multi-line CSS while strictly preserving trailing semicolons on statement @rules
  const formatCssNodes = (nodes, indent = '') => {
    const out = [];
    for (const node of nodes || []) {
      if (node.type === 'comment') continue;
      if (node.type === 'decl') {
        out.push(`${indent}${node.prop}: ${node.value}${node.important ? ' !important' : ''};`);
      } else if (node.type === 'rule') {
        const inner = formatCssNodes(node.nodes, `${indent}  `);
        out.push(`${indent}${node.selector} {\n${inner.join('\n')}\n${indent}}`);
      } else if (node.type === 'atrule') {
        if (!node.nodes) {
          const stmt = `${indent}@${node.name}${node.params ? ` ${node.params}` : ''}`;
          out.push(stmt.endsWith(';') ? stmt : `${stmt};`);
        } else {
          const inner = formatCssNodes(node.nodes, `${indent}  `);
          out.push(`${indent}@${node.name}${node.params ? ` ${node.params}` : ''} {\n${inner.join('\n')}\n${indent}}`);
        }
      } else {
        out.push(`${indent}${node.toString()}`);
      }
    }
    return out;
  };

  const formattedRules = formatCssNodes(root.nodes, '');
  const outCss = formattedRules.join('\n\n') + '\n';
  // Roundtrip assertion: verify sanitized CSS parses cleanly with zero syntax errors
  try {
    postcss.parse(outCss);
  } catch (verifyErr) {
    throw new Error(`sanitizeAndFormatCss produced invalid CSS: ${verifyErr.message}`);
  }
  return outCss;
}

export function harmonizeFormA11y(htmlOrMarkup) {
  const inputIdMatches = Array.from(
    htmlOrMarkup.matchAll(/<(?:input|textarea|select)[^>]*\bid=["']([^"']+)["'][^>]*>/gi)
  );
  const existingIds = new Set(inputIdMatches.map((m) => m[1]));

  let fixedHtml = htmlOrMarkup.replace(/<label\b([^>]*\bfor=["']([^"']+)["'][^>]*)>/gi, (match, _attrs, forVal) => {
    if (existingIds.has(forVal)) return match;
    const candidate = Array.from(existingIds).find((id) => id.startsWith(forVal + '-') || id.endsWith('-' + forVal));
    if (candidate) {
      return match.replace(new RegExp(`for=["']${forVal}["']`), `for="${candidate}"`);
    }
    return match;
  });

  fixedHtml = fixedHtml.replace(/<(input|textarea)\b([^>]*?)(\/?)>/gi, (match, tag, attrs, closing) => {
    if (/\bautocomplete\s*=/i.test(attrs) || attrs.includes('{...')) return match;

    const typeMatch = attrs.match(/\btype=["']([^"']+)["']/i);
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
    const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i);

    const type = (typeMatch ? typeMatch[1] : tag.toLowerCase() === 'textarea' ? 'textarea' : 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(type)) return match;

    const hint = `${idMatch ? idMatch[1] : ''} ${nameMatch ? nameMatch[1] : ''}`.toLowerCase();
    let token = 'off';
    if (type === 'email' || hint.includes('email')) token = 'email';
    else if (type === 'tel' || hint.includes('phone') || hint.includes('tel')) token = 'tel';
    else if (type === 'url' || hint.includes('url') || hint.includes('website')) token = 'url';
    else if (type === 'password') token = 'current-password';
    else if (hint.includes('first') || hint.includes('given')) token = 'given-name';
    else if (hint.includes('last') || hint.includes('family') || hint.includes('sur')) token = 'family-name';
    else if (hint.includes('name') && !hint.includes('username')) token = 'name';
    else if (hint.includes('username')) token = 'username';

    return `<${tag}${attrs} autocomplete="${token}"${closing ? ' /' : ''}>`;
  });

  return fixedHtml;
}
