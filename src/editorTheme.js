import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * The shared syntax HighlightStyle: syntax-tree tags → the --syn-* theme tokens.
 *
 * Emitting `var(--syn-…)` as literal CSS values is what makes a theme switch retune highlighted
 * code instantly with no editor reconfiguration. Used by CodeEditor and DiffView (own module —
 * react-refresh requires component files to export only components). No colour literals here,
 * per the token rule.
 */
export const tokenHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.operatorKeyword, t.controlKeyword, t.definitionKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.character, t.docString], color: 'var(--syn-string)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.number, t.integer, t.float, t.bool, t.null], color: 'var(--syn-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--syn-function)' },
  { tag: [t.definition(t.variableName), t.variableName, t.special(t.variableName)], color: 'var(--syn-variable)' },
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], color: 'var(--syn-attribute)' },
  { tag: [t.typeName, t.className, t.namespace, t.annotation], color: 'var(--syn-type)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--syn-tag)' },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator], color: 'var(--syn-punct)' },
  { tag: [t.meta, t.processingInstruction, t.documentMeta], color: 'var(--syn-meta)' },
  { tag: [t.regexp, t.escape], color: 'var(--syn-regex)' },
  { tag: [t.self, t.atom, t.unit, t.constant(t.variableName), t.standard(t.variableName), t.labelName], color: 'var(--syn-constant)' },
  { tag: t.invalid, color: 'var(--syn-invalid)' },
  // Markdown-ish tags — also what the markdown EDIT mode's source pane renders with.
  { tag: t.heading, color: 'var(--syn-keyword)', fontWeight: 'bold' },
  { tag: [t.link, t.url], color: 'var(--syn-string)', textDecoration: 'underline' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' }
]);
