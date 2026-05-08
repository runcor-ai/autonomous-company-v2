// CapabilitiesLayer — renders the engine adapter view (FR-092, FR-200, FR-200c).
//
// Per contracts/prompt-stack-layers.md. NEVER empty: at minimum the local MCP module's
// 9 inherited tools are registered at boot before the first cycle prompt.
// Source: `LayerContext.capabilityList`, populated by the cycle-context-builder via
// `engine.listAdapterTools()` — the single source of truth (FR-092).

import type { PromptLayer, LayerContext } from 'runcor-substrate';

export class CapabilitiesLayer implements PromptLayer {
  readonly name = 'capabilities';

  render(context: LayerContext): string {
    // Header is constraining: agent learned to hallucinate tool names ("system_diagnostic")
    // when the header read "you may invoke any of these". Make the closure explicit.
    const lines = [
      'Capabilities — these are the ONLY tools you can invoke. Tool names that are NOT on this list will fail when called:',
    ];
    if (context.capabilityList.length === 0) {
      lines.push('  (none registered)');
    } else {
      for (const tool of context.capabilityList) {
        lines.push(`  - ${tool.name} — ${tool.description}`);
      }
    }
    return lines.join('\n');
  }
}
