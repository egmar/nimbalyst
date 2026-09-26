import { ModelRegistry } from '@nimbalyst/runtime/ai/server/ModelRegistry';
import { resolveClaudeEndpointConfig } from '@nimbalyst/runtime/ai/server/providers/claudeCode/claudeEndpoint';

/**
 * The model a new agent session starts on when the user has never chosen one.
 *
 * `settings:get-default-ai-model` answers with the stored choice, and this runs
 * only when there is none — the case where the renderer falls back to its own
 * literal (`claude-code:opus-1m`, `store/atoms/appSettings.ts`). Behind a custom
 * Anthropic-compatible endpoint that literal is a shipped variant, which resolves
 * to the pinned Anthropic id; the endpoint answers `model_not_found` (404). The
 * endpoint's own model — the settings.json `model`, else the first model it
 * serves — has to win instead, which is the same rule the runtime already applies
 * to a session created without an explicit model (`ModelRegistry.getDefaultModel`).
 *
 * Undefined when no endpoint is configured, leaving the renderer's literal in
 * charge. Routing the shipped case through the registry as well would quietly
 * move the shipped default from `claude-code:opus-1m` to `claude-code:opus`.
 *
 * A stored value is never second-guessed: a model the user picked stays picked.
 */
export async function resolveUnchosenAgentDefaultModel(
  storedModel: string | undefined,
): Promise<string | undefined> {
  if (storedModel) return storedModel;

  const endpoint = await resolveClaudeEndpointConfig();
  if (!endpoint) return undefined;

  return ModelRegistry.getDefaultModel('claude-code');
}
