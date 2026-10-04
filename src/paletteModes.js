import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
  ArrowBendDownRight, Warning, Function as FunctionIcon, Cube, Shapes, ListNumbers, TextT,
  Package, PuzzlePiece, BracketsCurly, TextH, FileCode, FileText
} from '@phosphor-icons/react';

/**
 * paletteModes.js: the command palette's prefix modes (1.14.0).
 *
 *   :  go to line          ":42", ":42:7" (line:column) in the active tab
 *   @  go to symbol        the active tab's functions, classes, … or its Markdown headings
 *   #  search open tabs    case-insensitive text search across every open tab
 *
 * createPaletteModes(ctx) builds the three from callbacks App supplies, because App owns the tabs
 * and the editors:
 *
 *   ctx.getActiveDoc()             the active tab's doc ({ id, kind, name, … }), or null
 *   ctx.getActiveView()            the active tab's live CodeMirror EditorView, or null (a Markdown
 *                                  tab in its reading view has none)
 *   ctx.getDocs()                  every open tab's doc, in tab order
 *   ctx.getDocText(doc)            a tab's current text (the live buffer when an editor is mounted)
 *   ctx.activateDoc(id)            make a tab the active one
 *   ctx.revealLine(docId, l, c)    put the caret on line l, column c (1-based) and show it; in a
 *                                  reading view, scroll to that source line
 *
 * A mode is { label, hint, placeholder, getItems(query) }. The palette passes the query without
 * its prefix and shows the returned items as they are, in order: modes rank their own results.
 * Items have the palette's usual shape { id, label, detail?, icon?, run } plus two optional flags:
 * `disabled` (a hint or empty-state row that Enter and clicks ignore) and `error` (the same, shown
 * as a problem with the input).
 *
 * Everything below createPaletteModes is pure and unit-tested under Node
 * (test/paletteModes.test.mjs).
 */

/**
 * Subsequence match with a small scorer: consecutive hits and word starts count extra. Shared by
 * the palette's main list and the symbol filter, so both rank the same way.
 */
export function scoreMatch(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      streak++;
      score += 1 + streak; // consecutive matches compound
      if (ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '.') score += 4; // word starts matter
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : 0;
}

/* ── : go to line ─────────────────────────────────────────────────────────────────────────── */

/** Lines in a string: one more than its line breaks (the renderer only ever holds `\n`). */
export function countLines(text) {
  if (!text) return 1;
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** Length of 1-based line `n` of a string, 0 past the end. */
export function lineLengthIn(text, n) {
  let start = 0;
  for (let i = 1; i < n; i++) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) return 0;
    start = nl + 1;
  }
  const end = text.indexOf('\n', start);
  return (end === -1 ? text.length : end) - start;
}

/**
 * Parse what follows ":" in the palette: "42", "42:7" or "42,7". Returns null for nothing typed,
 * { line, col } (col null when not given), or { error } with a message for the palette row.
 * "42:" counts as line 42, since the column is usually still being typed.
 */
export function parseLineQuery(query) {
  const q = (query ?? '').trim();
  if (!q) return null;
  const m = /^(\d+)(?:\s*[:,]\s*(\d*))?$/.exec(q);
  if (!m) return { error: 'Type a line number, like 42 or 42:7' };
  return { line: parseInt(m[1], 10), col: m[2] ? parseInt(m[2], 10) : null };
}

/**
 * Clamp a 1-based line and column into a document of `lineCount` lines. `lineLength(n)` gives a
 * line's length; the column may sit one past the end, after the last character. A missing column
 * is column 1.
 */
export function clampLineCol(line, col, lineCount, lineLength) {
  const l = Math.min(Math.max(1, line), Math.max(1, lineCount));
  const maxCol = (lineLength ? lineLength(l) : 0) + 1;
  const c = col == null ? 1 : Math.min(Math.max(1, col), maxCol);
  return { line: l, col: c };
}

/* ── # search open tabs ───────────────────────────────────────────────────────────────────── */

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Case-insensitive plain-text search of one string. At most `limit` hits and one per line, as
 * { line, col, text } with a 1-based line and column and the whole line's text.
 *
 * A RegExp with the `i` flag rather than indexOf over a lower-cased copy: lower-casing can change
 * a string's length ("İ" becomes two code units), which would shift every position after it, and
 * it would copy every open document on every keystroke.
 */
export function searchText(text, query, limit = Infinity) {
  const hits = [];
  if (typeof text !== 'string' || !query || limit <= 0) return hits;
  const re = new RegExp(escapeRegExp(query), 'gi');
  let line = 1;
  let lineStart = 0;
  let counted = 0; // line breaks before this offset are already in `line`
  let m;
  while ((m = re.exec(text)) !== null) {
    const at = m.index;
    for (let nl = text.indexOf('\n', counted); nl !== -1 && nl < at; nl = text.indexOf('\n', nl + 1)) {
      line++;
      lineStart = nl + 1;
    }
    counted = at;
    const end = text.indexOf('\n', at);
    const lineEnd = end === -1 ? text.length : end;
    hits.push({ line, col: at - lineStart + 1, text: text.slice(lineStart, lineEnd) });
    if (hits.length >= limit || end === -1) break;
    re.lastIndex = lineEnd + 1; // one hit per line: carry on from the next line
  }
  return hits;
}

/**
 * Search several documents in tab order: at most `perDoc` hits from each and `total` in all.
 * Returns [{ doc, line, col, text }].
 */
export function searchDocs(docs, getText, query, { perDoc = 20, total = 200 } = {}) {
  const out = [];
  for (const doc of docs) {
    if (out.length >= total) break;
    for (const hit of searchText(getText(doc), query, Math.min(perDoc, total - out.length))) {
      out.push({ doc, ...hit });
    }
  }
  return out;
}

/**
 * A matching line as a palette label: trimmed, and when it is long (minified code, a log line),
 * cut to a window that keeps the match in view.
 */
export function snippet(lineText, col, max = 120) {
  const lead = lineText.length - lineText.trimStart().length;
  const t = lineText.trim();
  if (t.length <= max) return t;
  const at = Math.max(0, col - 1 - lead);
  const start = Math.max(0, Math.min(at - 30, t.length - max));
  return `${start > 0 ? '…' : ''}${t.slice(start, start + max)}${start + max < t.length ? '…' : ''}`;
}

/* ── @ go to symbol ───────────────────────────────────────────────────────────────────────── */

/*
 * Symbols come from the Lezer syntax tree the editor already has, so every tree-based language
 * FATE bundles works without a per-language outline module. Lezer grammars name their nodes
 * consistently enough for a table: a definition node (FunctionDeclaration, ClassDefinition,
 * FunctionItem, FunctionDecl, …) with an identifier-like child that is its name. Stream-parsed
 * legacy modes (PowerShell, shell, batch, …) build no tree, so they simply have no symbols.
 */

/** Definition node → symbol kind, for the bundled grammars. */
const SYMBOL_NODES = {
  // JavaScript, TypeScript, JSX (also inside HTML <script>)
  FunctionDeclaration: 'function',
  ClassDeclaration: 'class', // also Java, PHP
  MethodDeclaration: 'method', // also Java, PHP
  InterfaceDeclaration: 'interface', // also Java, PHP
  TypeAliasDeclaration: 'type',
  EnumDeclaration: 'enum', // also Java, PHP
  NamespaceDeclaration: 'module',
  // Python (and PHP / C / C++ functions)
  FunctionDefinition: 'function',
  ClassDefinition: 'class',
  // Rust
  FunctionItem: 'function',
  StructItem: 'struct',
  UnionItem: 'struct',
  EnumItem: 'enum',
  TraitItem: 'interface',
  TypeItem: 'type',
  ModItem: 'module',
  MacroDefinition: 'function',
  // Go (TypeSpec is refined to struct or interface by its type)
  FunctionDecl: 'function',
  MethodDecl: 'method',
  TypeSpec: 'type',
  // Java
  ConstructorDeclaration: 'method',
  RecordDeclaration: 'class',
  AnnotationTypeDeclaration: 'interface',
  // C, C++ (specifiers only count with a body: `struct stat st;` is a use, not a definition)
  StructSpecifier: 'struct',
  UnionSpecifier: 'struct',
  ClassSpecifier: 'class',
  EnumSpecifier: 'enum',
  NamespaceDefinition: 'module',
  TypeDefinition: 'type', // C typedef; in JS/TS the same name is a leaf (a type's name), skipped
  // PHP
  TraitDeclaration: 'interface'
};

/** Fallback for grammars outside the table: Function/Class/…Declaration, …Definition, …Item. */
const GENERIC_SYMBOL =
  /^(Function|Method|Constructor|Class|Interface|Trait|Enum|Struct|Union|TypeAlias|Module|Namespace)(?:Declaration|Definition|Decl|Item|Statement|Specifier|Spec)$/;
const GENERIC_KINDS = {
  Function: 'function', Method: 'method', Constructor: 'method', Class: 'class',
  Interface: 'interface', Trait: 'interface', Enum: 'enum', Struct: 'struct', Union: 'struct',
  TypeAlias: 'type', Module: 'module', Namespace: 'module'
};

/** Bodies a C/C++ specifier must have to be a definition. */
const SPECIFIER_BODIES = new Set(['FieldDeclarationList', 'EnumeratorList']);

/** Names that ARE a definition's name. The first such child wins. */
const DEFINITION_NAMES = new Set([
  'VariableDefinition', 'TypeDefinition', 'DefName', 'Definition', 'BoundIdentifier',
  'PropertyDefinition', 'PrivatePropertyDefinition'
]);

/**
 * Plain identifiers, used when there is no definition-flavoured name. The first one wins, so a
 * Python `class Bar(Base)` is Bar, not Base (which sits deeper, in the argument list).
 */
const IDENTIFIER_NAMES = new Set([
  'VariableName', 'Name', 'Identifier', 'TypeIdentifier', 'FieldName', 'FieldIdentifier',
  'NamespaceIdentifier', 'ScopedIdentifier', 'QualifiedIdentifier', 'DestructorName',
  'OperatorName', 'KeyframeName'
]);

/** Inside a C/C++ declarator: what names the declared thing. */
const DECLARATOR_NAMES = new Set([
  'Identifier', 'FieldIdentifier', 'ScopedIdentifier', 'QualifiedIdentifier', 'DestructorName',
  'OperatorName', 'TypeIdentifier'
]);

/** Containers whose function-like members are methods. */
const CLASS_CONTAINERS = new Set([
  'ClassDeclaration', 'ClassDefinition', 'ClassExpression', 'ClassSpecifier', 'StructSpecifier',
  'UnionSpecifier', 'ImplItem', 'TraitItem', 'InterfaceDeclaration', 'EnumDeclaration',
  'RecordDeclaration', 'TraitDeclaration'
]);

/** Function bodies: a function declared inside one is a nested function, not a method. */
const FUNCTION_CONTAINERS = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunction', 'MethodDeclaration',
  'FunctionDefinition', 'FunctionItem', 'FunctionDecl', 'MethodDecl', 'ConstructorDeclaration',
  'LambdaExpression'
]);

/** JS values that make `const name = …` (or a class field) a function or class symbol. */
const FUNCTION_VALUES = { ArrowFunction: 'function', FunctionExpression: 'function', ClassExpression: 'class' };

const HEADING_NODE = /^(?:ATXHeading([1-6])|SetextHeading([12]))$/;

/** Markdown blocks whose content is never a heading (and may hold another language's tree). */
const MARKDOWN_SKIP = new Set(['FencedCode', 'CodeBlock', 'HTMLBlock', 'CommentBlock']);

/** Position lookups over either a string or a CodeMirror Text. */
function sourceOf(source) {
  if (typeof source !== 'string') {
    return {
      slice: (from, to) => source.sliceString(from, to),
      lineAt: (pos) => source.lineAt(pos)
    };
  }
  const starts = [0];
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) starts.push(i + 1);
  return {
    slice: (from, to) => source.slice(from, to),
    lineAt(pos) {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= pos) lo = mid;
        else hi = mid - 1;
      }
      return { number: lo + 1, from: starts[lo] };
    }
  };
}

/** The name node inside a C/C++ declarator chain (pointer → function → identifier), or null. */
function declaratorName(node) {
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
    const n = ch.type.name;
    if (n.endsWith('Declarator')) {
      const inner = declaratorName(ch);
      if (inner) return inner;
    } else if (DECLARATOR_NAMES.has(n)) {
      return ch;
    }
  }
  return null;
}

/**
 * A definition node's name node: the first definition-flavoured child, else the name inside a
 * C/C++ declarator (so `MyType Klass::run()` is Klass::run, not its return type), else the first
 * plain identifier. Only direct children: names deeper down belong to parameters and bodies.
 */
function nameNode(node) {
  let plain = null;
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
    const n = ch.type.name;
    if (DEFINITION_NAMES.has(n)) return ch;
    if (n.endsWith('Declarator')) {
      const inner = declaratorName(ch);
      if (inner) return inner;
    } else if (!plain && IDENTIFIER_NAMES.has(n)) {
      plain = ch;
    }
  }
  return plain;
}

function hasChild(node, names) {
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) if (names.has(ch.type.name)) return true;
  return false;
}

/** Text from a node's start up to its first child of type `bodyName`, on one line. */
function headerText(src, node, bodyName) {
  let end = node.to;
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
    if (ch.type.name === bodyName) {
      end = ch.from;
      break;
    }
  }
  const text = src.slice(node.from, end).replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/**
 * Heading text without Markdown syntax: links and images keep their text, code spans and emphasis
 * lose their marks, inline HTML tags go.
 */
export function plainHeading(text) {
  let plain = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w_])_(?=\S)(.+?)(?<=\S)_(?![\w_])/g, '$1$2');
  /*
   * Inline HTML tags go, repeatedly until none are left (`<<b>i>` hides a tag inside a tag), and so
   * does a tag left unclosed at the end. The label is rendered as text, so this is only cosmetic, but
   * a single pass is the classic incomplete-sanitising mistake and code scanning rightly flags it.
   */
  for (let previous; previous !== plain; ) {
    previous = plain;
    plain = plain.replace(/<[^<>]*>/g, '');
  }
  return plain.replace(/<[a-zA-Z/!][^>]*$/, '').replace(/\s+/g, ' ').trim();
}

/** An ATX heading line's text: without the opening #s and the optional closing #s. */
const atxText = (line) =>
  line.replace(/^ {0,3}#{1,6}(?=[ \t]|$)[ \t]*/, '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '');

/**
 * Every symbol in a Lezer tree, in document order, as { name, kind, line, col, level? }. `source`
 * is the parsed text: a string, or the editor's CodeMirror Text (state.doc). Kinds: function,
 * method, class, interface, enum, type, struct, module, impl, rule (CSS) and heading (Markdown,
 * with its level).
 */
export function extractSymbols(tree, source, { limit = 5000 } = {}) {
  const src = sourceOf(source);
  const symbols = [];
  /** Open containers, innermost last: 'class' or 'function'. Decides function vs method. */
  const scopes = [];

  const add = (name, kind, at, extra) => {
    if (!name || symbols.length >= limit) return;
    const line = src.lineAt(at);
    symbols.push({ name, kind, line: line.number, col: at - line.from + 1, ...extra });
  };
  const inClass = () => scopes[scopes.length - 1] === 'class';

  tree.iterate({
    enter(ref) {
      const type = ref.type.name;

      const heading = HEADING_NODE.exec(type);
      if (heading) {
        const raw = src.slice(ref.from, ref.to);
        const text = heading[1]
          ? atxText(raw)
          : raw.slice(0, raw.lastIndexOf('\n') === -1 ? raw.length : raw.lastIndexOf('\n'));
        add(plainHeading(text), 'heading', ref.from, { level: Number(heading[1] || heading[2]) });
        return false;
      }
      if (MARKDOWN_SKIP.has(type)) return false;

      if (CLASS_CONTAINERS.has(type)) scopes.push('class');
      else if (FUNCTION_CONTAINERS.has(type)) scopes.push('function');

      // Rules and impl blocks are named by their header, not by one identifier.
      if (type === 'RuleSet') {
        add(headerText(src, ref.node, 'Block'), 'rule', ref.from);
        return;
      }
      if (type === 'ImplItem') {
        add(headerText(src, ref.node, 'DeclarationList'), 'impl', ref.from);
        return;
      }
      if (type === 'KeyframesStatement') {
        const name = nameNode(ref.node);
        if (name) add(`@keyframes ${src.slice(name.from, name.to)}`, 'rule', ref.from);
        return;
      }

      // `const name = () => …`, `let name = function …`, a class field `name = () => …`.
      if (type === 'VariableDeclaration' || type === 'PropertyDeclaration') {
        let pending = null;
        for (let ch = ref.node.firstChild; ch; ch = ch.nextSibling) {
          const n = ch.type.name;
          if (n === 'VariableDefinition' || n === 'PropertyDefinition') pending = ch;
          else if (pending && FUNCTION_VALUES[n]) {
            const kind = FUNCTION_VALUES[n] === 'function' && (type === 'PropertyDeclaration' || inClass())
              ? 'method'
              : FUNCTION_VALUES[n];
            add(src.slice(pending.from, pending.to), kind, pending.from);
            pending = null;
          } else if (n !== 'Equals' && n !== 'TypeAnnotation') {
            pending = null;
          }
        }
        return;
      }

      // C/C++ prototypes: a declaration whose declarator is a function (`int add(int, int);`,
      // `void m();` in a class). Header files hold little else.
      if (type === 'Declaration' || type === 'FieldDeclaration') {
        const fn = functionDeclarator(ref.node);
        const name = fn && DECLARATOR_NAMES.has(fn.firstChild?.type.name) ? fn.firstChild : null;
        if (name) {
          const text = src.slice(name.from, name.to);
          add(text, type === 'FieldDeclaration' || text.includes('::') ? 'method' : 'function', name.from);
        }
        return;
      }

      let kind = SYMBOL_NODES[type];
      if (!kind) {
        const generic = GENERIC_SYMBOL.exec(type);
        if (!generic) return;
        kind = GENERIC_KINDS[generic[1]];
      }
      const node = ref.node;
      if (!node.firstChild) return; // a leaf: in JS/TS `TypeDefinition` is a type's NAME
      if (type.endsWith('Specifier') && !hasChild(node, SPECIFIER_BODIES)) return;
      if (type === 'TypeSpec') {
        if (hasChild(node, new Set(['StructType']))) kind = 'struct';
        else if (hasChild(node, new Set(['InterfaceType']))) kind = 'interface';
      }

      const name = nameNode(node);
      if (!name) return; // anonymous: `export default function () {}`, a computed method name
      const text = src.slice(name.from, name.to);
      if (kind === 'function') {
        // The scope pushed above is this node's own; look one further out.
        const outer = FUNCTION_CONTAINERS.has(type) ? scopes[scopes.length - 2] : scopes[scopes.length - 1];
        if (outer === 'class' || text.includes('::')) kind = 'method';
      }
      add(text, kind, name.from);
    },
    leave(ref) {
      const type = ref.type.name;
      if (CLASS_CONTAINERS.has(type) || FUNCTION_CONTAINERS.has(type)) scopes.pop();
    }
  });
  return symbols;
}

/**
 * The FunctionDeclarator a C/C++ declaration declares, through pointer and reference declarators
 * (`char *name(void)` is Pointer → Function), or null for anything else. The caller checks that
 * the declarator starts with a plain name: `int (*fp)(int);` is a pointer variable, not a function.
 */
function functionDeclarator(node) {
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
    const n = ch.type.name;
    if (n === 'FunctionDeclarator') return ch;
    if (n === 'PointerDeclarator' || n === 'ReferenceDeclarator') {
      const inner = functionDeclarator(ch);
      if (inner) return inner;
    }
  }
  return null;
}

/**
 * Markdown headings by scanning lines, for a tab with no editor (a Markdown file in its reading
 * view): ATX (`## Title`) and setext (a line underlined with === or ---), skipping fenced code
 * and YAML front matter. Same shape as extractSymbols' headings.
 */
export function extractMarkdownHeadings(text) {
  const headings = [];
  if (typeof text !== 'string' || !text) return headings;
  const lines = text.split('\n');
  let i = 0;

  // YAML front matter: `---` on the first line up to the next `---` or `...`.
  if (/^---[ \t]*$/.test(lines[0])) {
    for (let j = 1; j < lines.length; j++) {
      if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[j])) {
        i = j + 1;
        break;
      }
    }
  }

  let fence = null; // the open fence's character and length
  let prev = null; // the previous line, when it could be a setext heading's text
  for (; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (open) {
      fence = { char: open[1][0], len: open[1].length };
      prev = null;
      continue;
    }
    const atx = /^ {0,3}(#{1,6})(?:[ \t]|$)/.exec(line);
    if (atx) {
      const name = plainHeading(atxText(line));
      if (name) headings.push({ name, kind: 'heading', level: atx[1].length, line: i + 1, col: 1 });
      prev = null;
      continue;
    }
    const setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(line);
    if (setext && prev) {
      const name = plainHeading(prev.text);
      if (name) headings.push({ name, kind: 'heading', level: setext[1][0] === '=' ? 1 : 2, line: prev.line, col: 1 });
      prev = null;
      continue;
    }
    // Paragraph text that a following === / --- line turns into a heading, all of its lines
    // (a setext heading can span several). Blank lines, rules, list items and quotes end it, and
    // indented code can't start one (`- item` then `---` is a list and a rule).
    const blockStart = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)|^ {0,3}>|^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line);
    if (!line.trim() || blockStart) prev = null;
    else if (prev) prev = { text: `${prev.text} ${line}`, line: prev.line };
    else prev = /^(?: {4}|\t)/.test(line) ? null : { text: line, line: i + 1 };
  }
  return headings;
}

/** Symbols matching a query, best first (ties in document order); all of them for no query. */
export function filterSymbols(symbols, query) {
  const q = (query ?? '').trim();
  if (!q) return symbols;
  return symbols
    .map((s) => ({ s, score: scoreMatch(q, s.name) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.s.line - b.s.line)
    .map((r) => r.s);
}

/* ── The modes ────────────────────────────────────────────────────────────────────────────── */

const KIND_LABELS = {
  function: 'Function', method: 'Method', class: 'Class', interface: 'Interface', enum: 'Enum',
  type: 'Type', struct: 'Struct', module: 'Module', impl: 'Impl', rule: 'Rule'
};

const KIND_ICONS = {
  function: FunctionIcon, method: FunctionIcon, class: Cube, struct: Cube, interface: Shapes,
  enum: ListNumbers, type: TextT, module: Package, impl: PuzzlePiece, rule: BracketsCurly,
  heading: TextH
};

/** Rows shown at most for one symbol query; the rest are a "keep typing" row away. */
const MAX_SYMBOL_ROWS = 300;

/** A row Enter and clicks ignore: a hint, an empty state, or (error) a problem with the input. */
const notice = (id, label, error = false) => ({
  id,
  label,
  disabled: true,
  error,
  icon: error ? Warning : undefined,
  run: () => {}
});

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Build the `:`, `@` and `#` modes for the CommandPalette's `modes` prop. See the top of file. */
export function createPaletteModes(ctx) {
  /*
   * Symbols are cached per document state: CodeMirror's Text is immutable, so the same object
   * means the same content and the tree walk happens once per palette query session, not once per
   * keystroke. A reading-view tab is keyed on its text string instead.
   */
  let cache = { docId: null, key: null, symbols: [] };

  const symbolsFor = (doc) => {
    const view = ctx.getActiveView?.() ?? null;
    const key = view ? view.state.doc : (ctx.getDocText(doc) ?? '');
    if (cache.docId === doc.id && cache.key === key) return cache.symbols;
    let symbols = [];
    if (view) {
      // Parse to the end (up to 200 ms) so symbols below the visible part are found too; the
      // editor itself only parses as far as it needs to draw.
      const tree = ensureSyntaxTree(view.state, view.state.doc.length, 200) ?? syntaxTree(view.state);
      symbols = extractSymbols(tree, view.state.doc);
    } else if (doc.kind === 'markdown') {
      symbols = extractMarkdownHeadings(key);
    }
    cache = { docId: doc.id, key, symbols };
    return symbols;
  };

  const goToLine = {
    label: 'Go to line',
    hint: 'go to line',
    placeholder: 'Type a line number, or line:column',
    getItems(query) {
      const doc = ctx.getActiveDoc();
      if (!doc) return [notice('line-none', 'Open a document to go to a line')];
      const view = ctx.getActiveView?.() ?? null;
      const text = view ? null : (ctx.getDocText(doc) ?? '');
      const lineCount = view ? view.state.doc.lines : countLines(text);
      const parsed = parseLineQuery(query);
      if (!parsed) return [notice('line-hint', `Type a line number from 1 to ${lineCount}, or line:column`)];
      if (parsed.error) return [notice('line-error', parsed.error, true)];
      const lineLength = (n) => (view ? view.state.doc.line(n).length : lineLengthIn(text, n));
      const { line, col } = clampLineCol(parsed.line, parsed.col, lineCount, lineLength);
      return [{
        id: 'line-go',
        label: parsed.col != null ? `Go to line ${line}, column ${col}` : `Go to line ${line}`,
        detail: `${doc.name} · ${plural(lineCount, 'line')}`,
        icon: ArrowBendDownRight,
        run: () => ctx.revealLine(doc.id, line, col)
      }];
    }
  };

  const goToSymbol = {
    label: 'Go to symbol',
    hint: 'symbol',
    placeholder: 'Type to filter the symbols in this document',
    getItems(query) {
      const doc = ctx.getActiveDoc();
      if (!doc) return [notice('sym-none', 'Open a document to list its symbols')];
      const all = symbolsFor(doc);
      if (all.length === 0) {
        return [notice('sym-empty', doc.kind === 'markdown' ? 'This document has no headings' : 'No symbols found in this document')];
      }
      const matches = filterSymbols(all, query);
      if (matches.length === 0) return [notice('sym-nomatch', `No symbols match "${query.trim()}"`)];
      const rows = matches.slice(0, MAX_SYMBOL_ROWS).map((s) => ({
        id: `sym-${s.line}-${s.col}-${s.kind}`,
        label: s.name,
        detail: `${s.kind === 'heading' ? `Heading ${s.level}` : KIND_LABELS[s.kind]} · line ${s.line}`,
        icon: KIND_ICONS[s.kind],
        run: () => ctx.revealLine(doc.id, s.line, s.col)
      }));
      if (matches.length > MAX_SYMBOL_ROWS) {
        rows.push(notice('sym-more', `${matches.length - MAX_SYMBOL_ROWS} more. Keep typing to narrow the list.`));
      }
      return rows;
    }
  };

  const searchTabs = {
    label: 'Search open tabs',
    hint: 'search open tabs',
    placeholder: 'Type to search the text of every open tab',
    getItems(query) {
      const docs = ctx.getDocs() ?? [];
      const q = (query ?? '').replace(/^\s+/, ''); // the space after "#" is natural; trailing ones count
      if (docs.length === 0) return [notice('find-none', 'No tabs are open')];
      if (!q) return [notice('find-hint', `Type to search ${plural(docs.length, 'open tab')}`)];
      const hits = searchDocs(docs, (d) => ctx.getDocText(d) ?? '', q, { perDoc: 20, total: 200 });
      if (hits.length === 0) return [notice('find-nomatch', `No matches for "${q}" in open tabs`)];
      return hits.map((h) => ({
        id: `find-${h.doc.id}-${h.line}`,
        label: snippet(h.text, h.col),
        detail: `${h.doc.name}:${h.line}`,
        icon: h.doc.kind === 'code' ? FileCode : FileText,
        run: () => {
          if (ctx.getActiveDoc()?.id !== h.doc.id) ctx.activateDoc?.(h.doc.id);
          ctx.revealLine(h.doc.id, h.line, h.col);
        }
      }));
    }
  };

  return { ':': goToLine, '@': goToSymbol, '#': searchTabs };
}
