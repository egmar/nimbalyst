import { describe, it, expect } from 'vitest';
import { CLAUDE_CODE_VARIANTS, ModelIdentifier } from '@nimbalyst/runtime/ai/server/types';
import { isModelEnabled, resolveProviderEnabled } from '../modelEnablementFilter';

/**
 * The gate that once hid Fable 5 from the picker (NIM-1486). These lock in the
 * "can't happen again" invariant: an empty/undefined allow-list shows every
 * shipped variant, and the family conveniences (sentinel, -1m) work for the CLI
 * provider too — not just the SDK provider.
 */
describe('isModelEnabled', () => {
  const id = (provider: string, v: string) => ModelIdentifier.create(provider as any, v).combined;

  it('disabled provider hides everything', () => {
    expect(isModelEnabled({ id: 'claude-code:fable', provider: 'claude-code' }, { enabled: false })).toBe(false);
  });

  it('empty allow-list shows every shipped variant (incl. fable) for both families', () => {
    for (const provider of ['claude-code', 'claude-code-cli']) {
      for (const variant of CLAUDE_CODE_VARIANTS) {
        const base = { id: id(provider, variant), provider };
        expect(isModelEnabled(base, { enabled: true })).toBe(true); // undefined list
        expect(isModelEnabled(base, { enabled: true, models: [] })).toBe(true); // empty list
        // ...and the 1M row.
        const oneM = { id: id(provider, `${variant}-1m`), provider };
        expect(isModelEnabled(oneM, { enabled: true, models: [] })).toBe(true);
      }
    }
  });

  it('a non-empty list still restricts to listed ids', () => {
    const entry = { enabled: true, models: ['claude-code:opus'] };
    expect(isModelEnabled({ id: 'claude-code:opus', provider: 'claude-code' }, entry)).toBe(true);
    expect(isModelEnabled({ id: 'claude-code:fable', provider: 'claude-code' }, entry)).toBe(false);
  });

  it('selecting a base variant also surfaces its 1M row — for the CLI provider too', () => {
    // Regression: the old inline filter special-cased only `claude-code`, so a
    // claude-code-cli allow-list would have dropped the -1m row.
    const entry = { enabled: true, models: ['claude-code-cli:sonnet'] };
    expect(isModelEnabled({ id: 'claude-code-cli:sonnet', provider: 'claude-code-cli' }, entry)).toBe(true);
    expect(isModelEnabled({ id: 'claude-code-cli:sonnet-1m', provider: 'claude-code-cli' }, entry)).toBe(true);
  });

  it('the provider-id sentinel means "all of this provider" for both families', () => {
    expect(
      isModelEnabled({ id: 'claude-code:fable', provider: 'claude-code' }, { enabled: true, models: ['claude-code'] }),
    ).toBe(true);
    expect(
      isModelEnabled(
        { id: 'claude-code-cli:fable', provider: 'claude-code-cli' },
        { enabled: true, models: ['claude-code-cli'] },
      ),
    ).toBe(true);
  });

  describe('hiddenModels (denylist)', () => {
    it('hides exactly the listed ids and shows everything else', () => {
      const entry = { enabled: true, hiddenModels: ['claude-code:sonnet'] };
      expect(isModelEnabled({ id: 'claude-code:sonnet', provider: 'claude-code' }, entry)).toBe(false);
      expect(isModelEnabled({ id: 'claude-code:opus', provider: 'claude-code' }, entry)).toBe(true);
    });

    it('is independent per exact id — hiding a base variant leaves its 1M row visible', () => {
      // Denylist rows map 1:1 to picker rows; base and -1m are toggled separately.
      const entry = { enabled: true, hiddenModels: ['claude-code:opus'] };
      expect(isModelEnabled({ id: 'claude-code:opus', provider: 'claude-code' }, entry)).toBe(false);
      expect(isModelEnabled({ id: 'claude-code:opus-1m', provider: 'claude-code' }, entry)).toBe(true);
    });

    it('an empty/undefined hidden set shows everything', () => {
      expect(isModelEnabled({ id: 'claude-code:opus', provider: 'claude-code' }, { enabled: true, hiddenModels: [] })).toBe(true);
      expect(isModelEnabled({ id: 'claude-code:opus', provider: 'claude-code' }, { enabled: true })).toBe(true);
    });

    it('hidden wins over the allow-list — a hidden id is never shown even if allow-listed', () => {
      const entry = { enabled: true, models: ['claude-code:opus'], hiddenModels: ['claude-code:opus'] };
      expect(isModelEnabled({ id: 'claude-code:opus', provider: 'claude-code' }, entry)).toBe(false);
    });

    it('works for the CLI provider so its set can be trimmed independently', () => {
      const entry = { enabled: true, hiddenModels: ['claude-code-cli:haiku'] };
      expect(isModelEnabled({ id: 'claude-code-cli:haiku', provider: 'claude-code-cli' }, entry)).toBe(false);
      expect(isModelEnabled({ id: 'claude-code:haiku', provider: 'claude-code' }, entry)).toBe(true);
    });
  });

  /**
   * A custom Anthropic-compatible endpoint (settings.json `env.ANTHROPIC_BASE_URL`)
   * replaces the catalog with the endpoint's own models, so the picker lists ids
   * the curation could not have named: an allow/hide list is written from the
   * rows the user was shown, which were shipped variants. Applying it to an
   * endpoint row emptied the group entirely, and the picker then fell back to a
   * shipped label for a model the endpoint does not serve.
   */
  describe('endpoint-served models (ids outside the shipped variant namespace)', () => {
    const curated = {
      enabled: true,
      models: ['claude-code:fable'],
      hiddenModels: ['claude-code:opus', 'claude-code:opus-1m', 'claude-code:sonnet'],
    };

    it('are not filtered out by a list written in shipped ids', () => {
      expect(
        isModelEnabled({ id: 'claude-code:deepseek-v4.1-flash:cloud', provider: 'claude-code' }, curated),
      ).toBe(true);
    });

    it('are exempt for the CLI provider too', () => {
      const entry = { enabled: true, models: ['claude-code-cli:fable'] };
      expect(
        isModelEnabled({ id: 'claude-code-cli:deepseek-v4.1-flash:cloud', provider: 'claude-code-cli' }, entry),
      ).toBe(true);
    });

    it('leave the shipped rows restricted as before', () => {
      expect(isModelEnabled({ id: 'claude-code:opus', provider: 'claude-code' }, curated)).toBe(false);
      expect(isModelEnabled({ id: 'claude-code:opus-1m', provider: 'claude-code' }, curated)).toBe(false);
      expect(isModelEnabled({ id: 'claude-code:fable', provider: 'claude-code' }, curated)).toBe(true);
    });

    it('are still hidden when the denylist names them exactly', () => {
      const entry = { enabled: true, hiddenModels: ['claude-code:deepseek-v4.1-flash:cloud'] };
      expect(
        isModelEnabled({ id: 'claude-code:deepseek-v4.1-flash:cloud', provider: 'claude-code' }, entry),
      ).toBe(false);
    });

    it('are still hidden when their provider is off (the billing gate)', () => {
      expect(
        isModelEnabled({ id: 'claude-code-cli:deepseek-v4.1-flash:cloud', provider: 'claude-code-cli' }, { enabled: false }),
      ).toBe(false);
    });
  });
});

/**
 * The terminal-CLI provider used to default ON, so its models appeared in the
 * picker for everyone even though the settings toggle rendered off. Using a
 * Claude subscription never required it — Claude Agent already runs on the
 * subscription — so an absent setting must mean disabled.
 */
describe('resolveProviderEnabled', () => {
  it('claude-code-cli is off until explicitly enabled', () => {
    expect(resolveProviderEnabled('claude-code-cli', undefined)).toBe(false);
    expect(resolveProviderEnabled('claude-code-cli', {})).toBe(false);
    expect(resolveProviderEnabled('claude-code-cli', { enabled: true })).toBe(true);
    expect(resolveProviderEnabled('claude-code-cli', { enabled: false })).toBe(false);
  });

  it('claude-code stays on by default — it is the app default agent', () => {
    expect(resolveProviderEnabled('claude-code', undefined)).toBe(true);
    expect(resolveProviderEnabled('claude-code', { enabled: false })).toBe(false);
  });

  it('every other provider is opt-in', () => {
    for (const provider of ['claude', 'openai', 'lmstudio', 'opencode']) {
      expect(resolveProviderEnabled(provider, undefined)).toBe(false);
    }
  });
});
