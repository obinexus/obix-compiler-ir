/**
 * Which attributes are ACCESSIBILITY attributes: `role`, `tabindex`, `alt`, `for` (the association of a label with its control) and every `aria-*` — whatever their case, as HTML
 * has it. It is the attributes that exist for the sake of what an assistive technology perceives; `title`, `lang`, `hidden`, `disabled` and the rest also do other work and
 * stay ordinary attributes. The rule is closed and stated once, so the frontend that sorts an element's attributes and the checker that verifies it cannot disagree.
 */
const NAMED = new Set(["role", "tabindex", "alt", "for"]);
const ARIA = "aria-";

export function isAccessibilityAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  return NAMED.has(lower) || (lower.startsWith(ARIA) && lower.length > ARIA.length);
}
