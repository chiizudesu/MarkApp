/**
 * Template parsing & rendering: {{placeholder}} and {{#if cond}}...{{#else}}...{{/if}}
 * (aligned with DocuFrame templateService.)
 */

export interface TemplatePlaceholder {
  name: string;
  description?: string;
  format?: "text" | "currency" | "percentage" | "date" | "number";
}

export interface TemplateCondition {
  name: string;
  description?: string;
}

export type TemplateBlock =
  | { type: "text"; content: string }
  | {
      type: "conditional";
      condition: string;
      ifBlocks: TemplateBlock[];
      elseBlocks: TemplateBlock[];
    };

export interface ParsedTemplate {
  placeholders: TemplatePlaceholder[];
  conditions: TemplateCondition[];
  blocks: TemplateBlock[];
}

export interface ExtractionResult {
  placeholders: Record<string, string>;
  conditions: Record<string, boolean>;
}

export interface ValidationError {
  type: "unclosed_if" | "unclosed_else" | "orphan_else" | "orphan_endif";
  position?: number;
  message: string;
}

const PLACEHOLDER_REGEX = /\{\{([^#/][^}]*)\}\}/g;

export function extractPlaceholderNames(templateStr: string): string[] {
  const names = new Set<string>();
  let match;
  const re = /\{\{([^#/][^}]*)\}\}/g;
  while ((match = re.exec(templateStr)) !== null) {
    names.add(match[1].trim());
  }
  return Array.from(names);
}

export function extractConditionNames(templateStr: string): string[] {
  const names = new Set<string>();
  let match;
  const re = /\{\{#if\s+([a-zA-Z0-9_]+)\}\}/g;
  while ((match = re.exec(templateStr)) !== null) {
    names.add(match[1].trim());
  }
  return Array.from(names);
}

export function parseTemplate(templateStr: string): ParsedTemplate {
  const placeholders = extractPlaceholderNames(templateStr).map((name) => ({
    name,
    description: undefined,
    format: undefined as TemplatePlaceholder["format"],
  }));
  const conditions = extractConditionNames(templateStr).map((name) => ({
    name,
    description: undefined,
  }));
  const blocks = parseBlocks(templateStr, 0, templateStr.length);
  return { placeholders, conditions, blocks };
}

function parseBlocks(str: string, start: number, end: number): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];
  let pos = start;

  while (pos < end) {
    const nextIf = str.indexOf("{{#if ", pos);
    if (nextIf === -1 || nextIf >= end) {
      blocks.push({ type: "text", content: str.slice(pos, end) });
      break;
    }

    if (nextIf > pos) {
      blocks.push({ type: "text", content: str.slice(pos, nextIf) });
    }

    const condMatch = str.slice(nextIf).match(/^\{\{#if\s+([a-zA-Z0-9_]+)\}\}/);
    if (!condMatch) {
      pos = nextIf + 1;
      continue;
    }

    const condition = condMatch[1];
    const ifStart = nextIf + condMatch[0].length;
    const { elsePos, endPos } = findMatchingElseAndEnd(str, ifStart, end);

    let ifContent: string;
    let elseContent: string;
    if (elsePos === -1) {
      ifContent = str.slice(ifStart, endPos);
      elseContent = "";
    } else {
      ifContent = str.slice(ifStart, elsePos);
      elseContent = str.slice(elsePos + "{{#else}}".length, endPos);
    }

    const ifBlocks = parseBlocks(ifContent, 0, ifContent.length);
    const elseBlocks = elseContent ? parseBlocks(elseContent, 0, elseContent.length) : [];

    blocks.push({
      type: "conditional",
      condition,
      ifBlocks,
      elseBlocks,
    });

    pos = endPos + "{{/if}}".length;
  }

  return blocks;
}

function findMatchingElseAndEnd(str: string, start: number, limit: number): { elsePos: number; endPos: number } {
  let depth = 1;
  let pos = start;
  let elsePos = -1;

  while (pos < limit && depth > 0) {
    const nextIf = str.indexOf("{{#if ", pos);
    const nextElse = str.indexOf("{{#else}}", pos);
    const nextEnd = str.indexOf("{{/if}}", pos);

    if (nextEnd === -1 || nextEnd >= limit) {
      break;
    }

    if (nextElse !== -1 && nextElse < nextEnd && depth === 1 && elsePos === -1) {
      if (nextIf === -1 || nextElse < nextIf) {
        elsePos = nextElse;
      }
    }

    if (nextIf !== -1 && nextIf < nextEnd) {
      if (nextElse === -1 || nextIf < nextElse) {
        depth++;
        pos = nextIf + "{{#if ".length;
        continue;
      }
    }

    if (nextEnd < limit) {
      depth--;
      if (depth === 0) {
        return { elsePos, endPos: nextEnd };
      }
      pos = nextEnd + "{{/if}}".length;
    }
  }

  return { elsePos, endPos: limit };
}

function renderBlocks(blocks: TemplateBlock[], placeholders: Record<string, string>, conditions: Record<string, boolean>): string {
  return blocks.map((block) => renderBlock(block, placeholders, conditions)).join("");
}

function getConditionValue(conditions: Record<string, boolean>, key: string): boolean {
  if (conditions[key] !== undefined) return conditions[key];
  const lower = key.toLowerCase();
  const entry = Object.entries(conditions).find(([pk]) => pk.toLowerCase() === lower);
  return entry ? Boolean(entry[1]) : false;
}

function renderBlock(block: TemplateBlock, placeholders: Record<string, string>, conditions: Record<string, boolean>): string {
  if (block.type === "text") {
    return replacePlaceholdersInText(block.content, placeholders);
  }
  const conditionValue = getConditionValue(conditions, block.condition);
  const branch = conditionValue ? block.ifBlocks : block.elseBlocks;
  return renderBlocks(branch, placeholders, conditions);
}

function findPlaceholderValue(placeholders: Record<string, string>, key: string): string | undefined {
  const k = key.trim();
  if (placeholders[k] !== undefined) return placeholders[k];
  const lower = k.toLowerCase();
  const entry = Object.entries(placeholders).find(([pk]) => pk.toLowerCase() === lower);
  return entry?.[1];
}

function replacePlaceholdersInText(text: string, placeholders: Record<string, string>): string {
  return text.replace(PLACEHOLDER_REGEX, (_, name) => {
    const key = name.trim();
    const val = findPlaceholderValue(placeholders, key);
    return val !== undefined ? val : `{{${key}}}`;
  });
}

export function renderTemplate(templateStr: string, data: ExtractionResult): string {
  const parsed = parseTemplate(templateStr);
  return renderBlocks(parsed.blocks, data.placeholders ?? {}, data.conditions ?? {});
}

export function validateTemplate(templateStr: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const ifRe = /\{\{#if\s+[a-zA-Z0-9_]+\}\}/g;
  const elseRe = /\{\{#else\}\}/g;
  const endRe = /\{\{\/if\}\}/g;
  const positions: { type: "if" | "else" | "end"; pos: number }[] = [];
  let m;
  while ((m = ifRe.exec(templateStr)) !== null) positions.push({ type: "if", pos: m.index });
  while ((m = elseRe.exec(templateStr)) !== null) positions.push({ type: "else", pos: m.index });
  while ((m = endRe.exec(templateStr)) !== null) positions.push({ type: "end", pos: m.index });
  positions.sort((a, b) => a.pos - b.pos);

  let stackDepth = 0;
  for (const p of positions) {
    if (p.type === "if") {
      stackDepth++;
    } else if (p.type === "else") {
      if (stackDepth === 0) {
        errors.push({
          type: "orphan_else",
          position: p.pos,
          message: "{{#else}} without matching {{#if}}",
        });
      }
    } else if (p.type === "end") {
      stackDepth--;
      if (stackDepth < 0) {
        errors.push({
          type: "orphan_endif",
          position: p.pos,
          message: "{{/if}} without matching {{#if}}",
        });
        stackDepth = 0;
      }
    }
  }
  if (stackDepth > 0) {
    errors.push({
      type: "unclosed_if",
      message: `${stackDepth} unclosed {{#if}} block(s)`,
    });
  }
  return errors;
}
