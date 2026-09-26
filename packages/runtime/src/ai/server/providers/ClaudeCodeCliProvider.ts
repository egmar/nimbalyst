/**
 * Claude Code CLI provider — the genuine `claude` CLI running on the user's
 * Claude Pro/Max **subscription** (no API key / no metering). This is the
 * subscription/CLI half of the Claude Code provider family; `claude-code`
 * remains the Agent-SDK path billed to the user's API key.
 *
 * Two provider IDs, one vendor agent — mirrors the `openai-codex` /
 * `openai-codex-acp` precedent. The split keeps billing locked per session via
 * `shouldBlockStartedSessionProviderSwitch()` (a session can never flip between
 * the API-billed and subscription-billed paths once it has messages).
 *
 * Rollout is phased (see NIM-806 and
 * `nimbalyst-local/plans/terminal-session-type.md` → "Execution Modes, Safety,
 * and Fallback (B3 rollout)"):
 *
 * - Phase 0 (this file, initial): provider identity + model catalog wiring so
 *   the rest of the app can route, validate, and construct this provider. The
 *   actual CLI driving (`sendMessage`) lands in Phase 1.
 * - Phase 1+: spawn the interactive `claude` CLI in the ghostty-web terminal
 *   strip; observation backends (terminal-only → jsonl → proxy) reconstruct the
 *   native transcript.
 *
 * HARD SAFETY INVARIANT: this provider never reads API keys from the
 * environment and the observation axis (proxy → jsonl → terminal-only) never
 * crosses the billing axis. See CLAUDE.md.
 */

import { BaseAgentProvider } from './BaseAgentProvider';
import {
  AIModel,
  AIProviderType,
  DocumentContext,
  ProviderConfig,
  StreamChunk,
} from '../types';
import { DEFAULT_MODELS } from '../../modelConstants';
import { buildClaudeFamilyCatalog, resolveClaudeFamilyDefaultModel } from './claudeCode/claudeEndpoint';
import type { ProviderSessionData } from './ProviderSessionManager';

export class ClaudeCodeCliProvider extends BaseAgentProvider {
  static readonly DEFAULT_MODEL = DEFAULT_MODELS['claude-code-cli'];

  getProviderName(): AIProviderType {
    return 'claude-code-cli';
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
  }

  // eslint-disable-next-line require-yield
  async *sendMessage(
    _message: string,
    _documentContext?: DocumentContext,
    _sessionId?: string,
    _messages?: unknown[],
    _workspacePath?: string,
    _attachments?: unknown[]
  ): AsyncIterableIterator<StreamChunk> {
    // Phase 1 wires this to the genuine `claude` CLI in the terminal strip.
    throw new Error(
      'claude-code-cli: the subscription CLI session is not yet implemented (Phase 1).'
    );
  }

  getProviderSessionData(sessionId: string): ProviderSessionData | null {
    const { providerSessionId } = this.sessions.getProviderSessionData(sessionId);
    return { providerSessionId };
  }

  /**
   * Model catalog — shares the Claude variant set with `claude-code` but under
   * the `claude-code-cli:` namespace so the two providers stay distinct in the
   * registry and the per-session billing lock holds.
   *
   * Endpoint-shaped, like `claude-code`: against a custom Anthropic-compatible
   * endpoint the CLI serves that endpoint's models, not the shipped variants.
   */
  static async getModels(): Promise<AIModel[]> {
    return buildClaudeFamilyCatalog('claude-code-cli');
  }

  /**
   * Async for the same reason as `claude-code`: behind a custom endpoint the
   * default is the endpoint's model, not the pinned `claude-code-cli:opus`.
   */
  static async getDefaultModel(): Promise<string> {
    return resolveClaudeFamilyDefaultModel('claude-code-cli');
  }
}
