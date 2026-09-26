// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getClaudeCodeModelLabel, getClaudeCodeModelShortLabel } from '../modelUtils';

/**
 * A custom endpoint (settings.json `env.ANTHROPIC_BASE_URL`) serves model ids
 * outside the Claude variant namespace. They have no variant to name, and the
 * `sonnet` fallback labelled every one of them "Sonnet 5".
 */
describe('Claude Agent labels for non-variant models', () => {
  it('shows the endpoint model id instead of a Claude variant', () => {
    expect(getClaudeCodeModelLabel('claude-code:deepseek-v4.1-flash:cloud')).toBe(
      'Claude Agent · deepseek-v4.1-flash:cloud',
    );
    expect(getClaudeCodeModelShortLabel('claude-code:deepseek-v4.1-flash:cloud')).toBe(
      'deepseek-v4.1-flash:cloud',
    );
  });

  it('keeps naming the shipped variants', () => {
    expect(getClaudeCodeModelShortLabel('claude-code:opus')).toBe('Opus 5.5');
    expect(getClaudeCodeModelLabel('claude-code-cli:opus-1m')).toBe('Claude Code CLI · Opus 5.5 (1M)');
  });
});
