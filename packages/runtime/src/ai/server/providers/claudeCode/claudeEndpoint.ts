/**
 * Custom Anthropic-compatible endpoint support for the Claude Agent family
 * (`claude-code` and `claude-code-cli`).
 *
 * A user may point Claude Code at a gateway of their own via
 * `~/.claude/settings.json`:
 *
 * ```json
 * { "env": { "ANTHROPIC_BASE_URL": "...", "ANTHROPIC_AUTH_TOKEN": "..." },
 *   "model": "deepseek-v4.1-flash:cloud" }
 * ```
 *
 * The child process reaches that gateway, so the shipped Anthropic variant
 * rows are wrong twice over: they name models the gateway does not serve, and
 * selecting one sends its pinned Anthropic id (`claude-opus-5-5`), which the
 * gateway answers with `model_not_found` (404). The catalog therefore has to
 * come from the endpoint itself.
 *
 * Degradation order, so the picker is never empty: endpoint discovery →
 * the settings.json `model` seed → the shipped variants. An
 * Anthropic-compatible gateway proxying real Claude accepts the aliases, so a
 * fallback list is better than none.
 *
 * The host injects the config; this module never reads `process.env` and never
 * reads an API key store. Only the base URL is ever logged — the auth token
 * is written into a request header and nowhere else.
 */

import { CLAUDE_CODE_VARIANTS, type AIModel } from '../../types';
import { ModelIdentifier } from '../../ModelIdentifier';
import {
  CLAUDE_CODE_MODEL_LABELS,
  CLAUDE_CODE_VARIANT_VERSIONS,
  CLAUDE_CODE_VARIANTS_WITH_1M,
  DEFAULT_MODELS,
  baseContextWindowForVariant,
} from '../../../modelConstants';

/** The two provider ids that share the Claude variant namespace. */
export type ClaudeFamilyProvider = 'claude-code' | 'claude-code-cli';

export interface ClaudeEndpointConfig {
  baseUrl: string;
  /** Sent as both `Authorization: Bearer` and `x-api-key`. Never logged. */
  authToken?: string;
  /** Top-level `model` from settings.json, used to seed and default. */
  model?: string;
}

export type ClaudeEndpointLoader = () => Promise<ClaudeEndpointConfig | null>;

export interface EndpointModel {
  id: string;
  displayName?: string;
}

/** Discovery is a nicety on the path to a picker; it must not stall one. */
const DISCOVERY_TIMEOUT_MS = 2_000;
const DISCOVERY_TTL_MS = 60_000;

/**
 * A discovered model's window is unknown until the SDK reports usage for it, so
 * every endpoint row carries the standard Claude window as a seed.
 * `resolveClaudeCodeParentContextWindow` corrects it from `modelUsage`.
 */
const ENDPOINT_CONTEXT_WINDOW = 200_000;

let endpointLoader: ClaudeEndpointLoader | null = null;
let discoveryCache: { key: string; models: EndpointModel[]; at: number } | null = null;
let inFlightDiscovery: Promise<EndpointModel[]> | null = null;
let inFlightKey: string | null = null;

/**
 * Inject the host's endpoint resolver, or `null` to disable endpoint support.
 * Called once at startup. Clears every memo: a newly injected loader must not
 * read state another host left behind.
 */
export function setClaudeEndpointLoader(loader: ClaudeEndpointLoader | null): void {
  endpointLoader = loader;
  discoveryCache = null;
  inFlightDiscovery = null;
  inFlightKey = null;
}

/**
 * True when a base URL points somewhere other than the first-party API.
 *
 * `undefined`/blank means "not configured". An unparseable non-empty value is
 * still treated as custom: it is definitely not `api.anthropic.com`, and
 * resolving the shipped variants against it is what produced the 404s.
 */
export function isCustomClaudeEndpoint(baseUrl: string | undefined | null): boolean {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return false;
  try {
    return new URL(trimmed).hostname.toLowerCase() !== 'api.anthropic.com';
  } catch {
    return true;
  }
}

/**
 * Read a `/v1/models` body. Anthropic answers `{ data: [{ id, display_name }] }`;
 * OpenAI-compatible gateways (Ollama, LiteLLM) answer the same shape or a bare
 * array. An endpoint with no models pulled answers `{ object: 'list',
 * data: null }` — a real response, not a failure.
 */
export function parseModelListResponse(body: unknown): EndpointModel[] {
  const entries = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.data)
      ? body.data
      : [];

  const models: EndpointModel[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      if (entry.trim()) models.push({ id: entry });
      continue;
    }
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) continue;

    const displayName =
      typeof entry.display_name === 'string'
        ? entry.display_name
        : typeof entry.displayName === 'string'
          ? entry.displayName
          : undefined;
    models.push(displayName ? { id: entry.id, displayName } : { id: entry.id });
  }
  return models;
}

/**
 * Resolve the endpoint the host would actually use for a child process, or
 * null when there is none (no loader, no base URL, or the first-party API).
 */
export async function resolveClaudeEndpointConfig(): Promise<ClaudeEndpointConfig | null> {
  if (!endpointLoader) return null;
  try {
    const config = await endpointLoader();
    if (!config || !isCustomClaudeEndpoint(config.baseUrl)) return null;
    // Normalize once here so no consumer has to guard a blank base URL or treat
    // an empty `model` as a seed.
    return {
      baseUrl: config.baseUrl.trim(),
      authToken: config.authToken?.trim() || undefined,
      model: config.model?.trim() || undefined,
    };
  } catch (error) {
    console.error(`[claude-endpoint] could not resolve the endpoint config: ${errorMessage(error)}`);
    return null;
  }
}

/**
 * Models the endpoint serves, memoized briefly and single-flighted: the picker
 * and the default-model read want the same answer, not two requests.
 */
export async function discoverEndpointModels(
  config: ClaudeEndpointConfig,
  options: { timeoutMs?: number } = {},
): Promise<EndpointModel[]> {
  const key = config.baseUrl;
  const cached = discoveryCache;
  if (cached && cached.key === key && Date.now() - cached.at < DISCOVERY_TTL_MS) {
    return cached.models;
  }
  if (inFlightDiscovery && inFlightKey === key) {
    return inFlightDiscovery;
  }

  const promise = fetchEndpointModels(config, options.timeoutMs ?? DISCOVERY_TIMEOUT_MS).then((models) => {
    discoveryCache = { key, models, at: Date.now() };
    return models;
  });
  inFlightDiscovery = promise;
  inFlightKey = key;

  try {
    return await promise;
  } finally {
    if (inFlightDiscovery === promise) {
      inFlightDiscovery = null;
      inFlightKey = null;
    }
  }
}

/**
 * The Claude Agent catalog for one provider: what the endpoint serves when one
 * is configured, the shipped variants otherwise.
 */
export async function buildClaudeFamilyCatalog(provider: ClaudeFamilyProvider): Promise<AIModel[]> {
  const config = await resolveClaudeEndpointConfig();
  if (!config) return buildShippedClaudeFamilyCatalog(provider);

  const discovered = await discoverEndpointModels(config);
  const displayNames = new Map(discovered.map((model) => [model.id, model.displayName]));

  // The settings.json model leads: it is the one the user already chose, and the
  // one a new session will default to, so it should be the first row.
  const ordered: EndpointModel[] = [];
  if (config.model) {
    ordered.push({ id: config.model, displayName: displayNames.get(config.model) });
  }
  for (const model of discovered) {
    if (model.id !== config.model) ordered.push(model);
  }

  if (ordered.length === 0) {
    console.log(
      `[claude-endpoint] ${provider} catalog from ${endpointHost(config.baseUrl)}: endpoint listed no models, using the shipped variants`,
    );
    return buildShippedClaudeFamilyCatalog(provider);
  }

  const catalog = ordered.map((model) => ({
    id: ModelIdentifier.create(provider, model.id).combined,
    name: `${claudeFamilyDisplayPrefix(provider)} · ${model.displayName ?? model.id}`,
    provider,
    maxTokens: 8192,
    contextWindow: ENDPOINT_CONTEXT_WINDOW,
  }));
  // One line per catalog build (cached upstream for an hour): this is the
  // evidence a "why doesn't the picker follow my settings.json?" report needs.
  console.log(
    `[claude-endpoint] ${provider} catalog from ${endpointHost(config.baseUrl)}: ${catalog.map((m) => m.id).join(', ')}`,
  );
  return catalog;
}

/**
 * The model a new session should start on for one Claude Agent provider: the
 * endpoint's model when one is configured, the shipped default otherwise.
 *
 * `claude-code:opus` is a bad default behind a gateway — it resolves to the
 * pinned `claude-opus-5-5` and 404s — so the endpoint's own model must win.
 */
export async function resolveClaudeFamilyDefaultModel(provider: ClaudeFamilyProvider): Promise<string> {
  const shippedDefault = DEFAULT_MODELS[provider];
  const config = await resolveClaudeEndpointConfig();
  if (!config) return shippedDefault;

  if (config.model) {
    return ModelIdentifier.create(provider, config.model).combined;
  }

  const first = (await discoverEndpointModels(config))[0]?.id;
  return first ? ModelIdentifier.create(provider, first).combined : shippedDefault;
}

function buildShippedClaudeFamilyCatalog(provider: ClaudeFamilyProvider): AIModel[] {
  const prefix = claudeFamilyDisplayPrefix(provider);
  const models: AIModel[] = [];

  for (const variant of CLAUDE_CODE_VARIANTS) {
    // Current-gen variants run 1M natively at a flat price, so their base
    // window is 1M; legacy/haiku stay 200k (see baseContextWindowForVariant /
    // GitHub #825).
    models.push({
      id: ModelIdentifier.create(provider, variant).combined,
      name: `${prefix} · ${CLAUDE_CODE_MODEL_LABELS[variant]} ${CLAUDE_CODE_VARIANT_VERSIONS[variant]}`,
      provider,
      maxTokens: 8192,
      contextWindow: baseContextWindowForVariant(variant),
    });

    // A separate 1M row only for variants that still gate 1M behind the suffix;
    // current-gen variants already run 1M on their base row.
    if ((CLAUDE_CODE_VARIANTS_WITH_1M as readonly string[]).includes(variant)) {
      models.push({
        id: ModelIdentifier.create(provider, `${variant}-1m`).combined,
        name: `${prefix} · ${CLAUDE_CODE_MODEL_LABELS[variant]} ${CLAUDE_CODE_VARIANT_VERSIONS[variant]} (1M)`,
        provider,
        maxTokens: 8192,
        contextWindow: 1_000_000,
      });
    }
  }

  return models;
}

function claudeFamilyDisplayPrefix(provider: ClaudeFamilyProvider): string {
  return provider === 'claude-code-cli' ? 'Claude Code CLI' : 'Claude Agent';
}

async function fetchEndpointModels(
  config: ClaudeEndpointConfig,
  timeoutMs: number,
): Promise<EndpointModel[]> {
  const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' };
  if (config.authToken) {
    headers.Authorization = `Bearer ${config.authToken}`;
    // A real Anthropic-compatible gateway authenticates on either header; Ollama
    // and LiteLLM ignore both.
    headers['x-api-key'] = config.authToken;
  }

  try {
    const response = await fetch(modelsUrl(config.baseUrl), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      console.warn(`[claude-endpoint] model discovery answered HTTP ${response.status}`);
      return [];
    }
    return parseModelListResponse(await response.json());
  } catch (error) {
    // An unreachable gateway degrades to the settings seed or the shipped
    // variants. Log the host only: the token must not reach a log file.
    console.warn(
      `[claude-endpoint] model discovery failed for ${endpointHost(config.baseUrl)}: ${errorMessage(error)}`,
    );
    return [];
  }
}

function modelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  // `ANTHROPIC_BASE_URL` is normally the bare host (the SDK appends /v1), but a
  // gateway handed out with the version segment already on it is common enough
  // that appending again would request /v1/v1/models.
  return trimmed.endsWith('/v1') ? `${trimmed}/models` : `${trimmed}/v1/models`;
}

function endpointHost(baseUrl: string): string {
  try {
    return new URL(baseUrl.trim()).host;
  } catch {
    return 'the configured endpoint';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
