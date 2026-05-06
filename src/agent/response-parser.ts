// Parse the model's cycle response into a structured action invocation.
//
// The cycle prompt asks the model to return JSON with at least:
//   { "action": "<tool_name|none>", "args" or "payload": {...}, "reasoning" or "thought": "..." }
//
// Models return:
//   - bare JSON
//   - JSON wrapped in ```json fences
//   - JSON preceded/followed by free-form text
// The parser tolerates all three.

export interface ParsedAction {
  action: string;
  args: Record<string, unknown>;
  reasoning: string;
}

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)\s*```/i;

function extractJsonText(text: string): string | null {
  const fenced = text.match(FENCE_RE);
  if (fenced && fenced[1]) return fenced[1].trim();
  // First-balanced-braces extraction.
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseCycleResponse(responseText: string): ParsedAction | null {
  const jsonText = extractJsonText(responseText);
  if (!jsonText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const actionRaw = obj.action ?? obj.tool ?? obj.name;
  if (typeof actionRaw !== 'string' || actionRaw.length === 0) return null;

  const argsRaw = obj.args ?? obj.payload ?? obj.input ?? {};
  const args: Record<string, unknown> = typeof argsRaw === 'object' && argsRaw !== null ? (argsRaw as Record<string, unknown>) : {};

  const reasoningRaw = obj.reasoning ?? obj.thought ?? obj.rationale ?? '';
  const reasoning = typeof reasoningRaw === 'string' ? reasoningRaw : '';

  return { action: actionRaw, args, reasoning };
}
