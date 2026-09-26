// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelRegistry } from '@nimbalyst/runtime/ai/server/ModelRegistry';
import { resolveClaudeEndpointConfig } from '@nimbalyst/runtime/ai/server/providers/claudeCode/claudeEndpoint';
import { resolveUnchosenAgentDefaultModel } from '../agentDefaultModel';

vi.mock('@nimbalyst/runtime/ai/server/ModelRegistry', () => ({
  ModelRegistry: { getDefaultModel: vi.fn() },
}));
vi.mock('@nimbalyst/runtime/ai/server/providers/claudeCode/claudeEndpoint', () => ({
  resolveClaudeEndpointConfig: vi.fn(),
}));

/**
 * `claude-code:opus-1m` is the renderer's literal default for a new session. It
 * is a shipped variant: behind a custom endpoint it resolves to the pinned
 * Anthropic id and the endpoint answers `model_not_found` (404), so an unchosen
 * default has to come from the endpoint instead.
 */
describe('resolveUnchosenAgentDefaultModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps an explicit choice as-is, without asking about an endpoint', async () => {
    expect(await resolveUnchosenAgentDefaultModel('claude-code:fable')).toBe('claude-code:fable');
    expect(resolveClaudeEndpointConfig).not.toHaveBeenCalled();
  });

  it('uses the endpoint model when nothing was chosen', async () => {
    vi.mocked(resolveClaudeEndpointConfig).mockResolvedValue({ baseUrl: 'http://localhost:11434' });
    vi.mocked(ModelRegistry.getDefaultModel).mockResolvedValue('claude-code:deepseek-v4.1-flash:cloud');

    expect(await resolveUnchosenAgentDefaultModel(undefined)).toBe('claude-code:deepseek-v4.1-flash:cloud');
    expect(ModelRegistry.getDefaultModel).toHaveBeenCalledWith('claude-code');
  });

  it('leaves the renderer literal in charge when no endpoint is configured', async () => {
    vi.mocked(resolveClaudeEndpointConfig).mockResolvedValue(null);

    expect(await resolveUnchosenAgentDefaultModel(undefined)).toBeUndefined();
    expect(ModelRegistry.getDefaultModel).not.toHaveBeenCalled();
  });
});
