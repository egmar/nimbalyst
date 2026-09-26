// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeProvider } from '../ClaudeCodeProvider';
import { ClaudeCodeCliProvider } from '../ClaudeCodeCliProvider';
import {
  isCustomClaudeEndpoint,
  parseModelListResponse,
  setClaudeEndpointLoader,
} from '../claudeCode/claudeEndpoint';

/**
 * A user whose `~/.claude/settings.json` points Claude Code at an
 * Anthropic-compatible gateway (`env.ANTHROPIC_BASE_URL`) runs models Nimbalyst
 * never listed, and the shipped Anthropic rows are pinned to ids that gateway
 * rejects (`model_not_found`). The catalog has to come from the endpoint.
 */
const ENDPOINT = 'http://127.0.0.1:11434';

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  setClaudeEndpointLoader(null);
  fetchMock.mockResolvedValue(jsonResponse({ object: 'list', data: [{ id: 'deepseek-v4.1-flash:cloud' }] }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  setClaudeEndpointLoader(null);
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('isCustomClaudeEndpoint', () => {
  it('is false only for unset, blank, and first-party Anthropic hosts', () => {
    expect(isCustomClaudeEndpoint(undefined)).toBe(false);
    expect(isCustomClaudeEndpoint('   ')).toBe(false);
    expect(isCustomClaudeEndpoint('https://api.anthropic.com')).toBe(false);
    expect(isCustomClaudeEndpoint('http://127.0.0.1:11434')).toBe(true);
    expect(isCustomClaudeEndpoint('https://gateway.internal/anthropic')).toBe(true);
  });
});

describe('parseModelListResponse', () => {
  it('reads the data-array shape both Anthropic and OpenAI-compatible endpoints use', () => {
    expect(parseModelListResponse({ data: [{ id: 'a', display_name: 'Model A' }, { id: 'b' }] })).toEqual([
      { id: 'a', displayName: 'Model A' },
      { id: 'b' },
    ]);
  });

  it('tolerates `data: null` — an endpoint with nothing pulled answers exactly that', () => {
    expect(parseModelListResponse({ object: 'list', data: null })).toEqual([]);
  });

  it('reads a bare array and ignores entries a model id cannot be read from', () => {
    expect(parseModelListResponse(['x', { id: 'y' }, { display_name: 'z' }, '', 7, null])).toEqual([
      { id: 'x' },
      { id: 'y' },
    ]);
  });

  it('returns nothing for a shape it does not recognize', () => {
    expect(parseModelListResponse(undefined)).toEqual([]);
    expect(parseModelListResponse('nope')).toEqual([]);
    expect(parseModelListResponse({ models: [{ id: 'a' }] })).toEqual([]);
  });
});

describe('Claude Agent catalog behind a custom endpoint', () => {
  it('lists what the endpoint serves and hides the shipped Anthropic variants', async () => {
    setClaudeEndpointLoader(async () => ({ baseUrl: ENDPOINT }));

    const models = await ClaudeCodeProvider.getModels();

    expect(models.map((m) => m.id)).toEqual(['claude-code:deepseek-v4.1-flash:cloud']);
    // The whole point: an Anthropic variant row would be sent as a pinned
    // Anthropic id and 404 against this gateway.
    expect(models.map((m) => m.id)).not.toContain('claude-code:opus');
    expect(fetchMock).toHaveBeenCalledWith(ENDPOINT + '/v1/models', expect.objectContaining({ method: 'GET' }));
  });

  it('keeps the two providers on their own namespaces', async () => {
    setClaudeEndpointLoader(async () => ({ baseUrl: ENDPOINT }));

    await expect(ClaudeCodeCliProvider.getModels()).resolves.toEqual([
      expect.objectContaining({ id: 'claude-code-cli:deepseek-v4.1-flash:cloud' }),
    ]);
  });

  it('keeps the shipped variants when no endpoint is configured (no discovery request)', async () => {
    setClaudeEndpointLoader(async () => null);

    const models = await ClaudeCodeProvider.getModels();

    expect(models.map((m) => m.id)).toContain('claude-code:opus');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('seeds the settings.json model when discovery cannot reach the endpoint', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
    setClaudeEndpointLoader(async () => ({ baseUrl: ENDPOINT, model: 'deepseek-v4.1-flash:cloud' }));

    await expect(ClaudeCodeProvider.getModels()).resolves.toEqual([
      expect.objectContaining({ id: 'claude-code:deepseek-v4.1-flash:cloud' }),
    ]);
  });

  it('still offers the shipped variants when the endpoint lists nothing and settings name no model', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ object: 'list', data: null }));
    setClaudeEndpointLoader(async () => ({ baseUrl: ENDPOINT }));

    // An Anthropic-compatible gateway proxying real Claude accepts the aliases,
    // so an empty catalog is worse than an imperfect one.
    await expect(ClaudeCodeProvider.getModels()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'claude-code:opus' })]),
    );
  });
});

describe('default model behind a custom endpoint', () => {
  it('prefers the endpoint model named in settings.json', async () => {
    setClaudeEndpointLoader(async () => ({ baseUrl: ENDPOINT, model: 'qwen3-coder:30b' }));

    await expect(ClaudeCodeProvider.getDefaultModel()).resolves.toBe('claude-code:qwen3-coder:30b');
  });

  it('falls back to the first model the endpoint serves', async () => {
    setClaudeEndpointLoader(async () => ({ baseUrl: ENDPOINT }));

    await expect(ClaudeCodeProvider.getDefaultModel()).resolves.toBe(
      'claude-code:deepseek-v4.1-flash:cloud',
    );
  });

  it('keeps the shipped default when no endpoint is configured', async () => {
    setClaudeEndpointLoader(async () => null);

    await expect(ClaudeCodeProvider.getDefaultModel()).resolves.toBe('claude-code:opus');
  });
});
