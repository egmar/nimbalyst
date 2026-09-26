// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'jotai';
import type { PrimitiveAtom } from 'jotai';
import { store } from '@nimbalyst/runtime/store';

// Local-only state is driven from the test through this base atom: the mocked
// module then exports the same read-only atom shape the real one does, while the
// test decides whether the mode is active.
const localOnly = vi.hoisted(() => ({ base: null as unknown as PrimitiveAtom<boolean> }));

vi.mock('posthog-js/react', () => ({ usePostHog: () => null }));
vi.mock('@nimbalyst/runtime/ui/icons/MaterialSymbol', () => ({ MaterialSymbol: () => null }));
vi.mock('../../../../help', () => ({ HelpTooltip: () => null }));
vi.mock('../../../../store/atoms/appSettings', async () => {
  const { atom } = await import('jotai');
  const localOnlyBase = atom(false);
  localOnly.base = localOnlyBase;
  return {
    advancedSettingsAtom: atom({ customPathDirs: '', releaseChannel: 'alpha', alphaFeatures: {}, analyticsEnabled: true, localOnlyMode: false }),
    setAdvancedSettingsAtom: atom(null, () => {}),
    aiDebugSettingsAtom: atom({ showToolCalls: false, chatShowToolCalls: false, aiDebugLogging: false, showPromptAdditions: false }),
    setAIDebugSettingsAtom: atom(null, () => {}),
    resetWalkthroughsAtom: atom(null, () => {}),
    developerFeatureSettingsAtom: atom({ developerMode: true, developerFeatures: {} }),
    setDeveloperFeatureSettingsAtom: atom(null, () => {}),
    customPathDirsAtom: atom(''),
    localOnlyModeActiveAtom: atom((get) => get(localOnlyBase)),
    externalEditorSettingsAtom: atom({ editorType: 'system', customPath: '' }),
    setExternalEditorSettingsAtom: atom(null, () => {}),
    EXTERNAL_EDITOR_NAMES: {}, DEVELOPER_FEATURES: [],
    areAllDeveloperFeaturesEnabled: () => false,
    enableAllDeveloperFeatures: () => ({}), disableAllDeveloperFeatures: () => ({}),
  };
});
vi.mock('../../../../store/atoms/trackerAutomationAtoms', async () => {
  const { atom } = await import('jotai');
  return { trackerAutomationAtom: atom({ enabled: false }), setTrackerAutomationAtom: atom(null, () => {}) };
});
vi.mock('../../../../store/atoms/openProjects', async () => {
  const { atom } = await import('jotai');
  return { multiProjectModeAtom: atom(false), allowUnlimitedProjectsAtom: atom(false), openProjectsAtom: atom([]), activeWorkspacePathAtom: atom(''), restorePreviousProjectsAtom: atom(false) };
});

vi.mock('../../../../store/atoms/autoCommitAtoms', async () => {
  const { atom } = await import('jotai');
  return { autoCommitEnabledAtom: atom(false), setAutoCommitEnabledAtom: atom(null, () => {}) };
});
vi.mock('../../../common/AlphaBadge', () => ({ AlphaBadge: () => null, SETTINGS_ALPHA_TOOLTIP: '' }));

import { AgentFeaturesPanel } from '../../../Settings/AgentFeaturesPanel';
import { AdvancedPanel } from '../AdvancedPanel';
import { registerSettingsChangeListener } from '../../../../store/atoms/settingAtomFamily';

afterEach(cleanup);

it('offers external following only in Agent Features and persists deliberate toggles via main-process broadcasts', async () => {
  const settingsSet = vi.fn().mockResolvedValue(undefined);
  let changed!: (event: { key: string; value: unknown }) => void;
  const originalApi = window.electronAPI;
  window.electronAPI = { ...originalApi, settingsSet,
    claudeCode: { ...originalApi?.claudeCode, getSettings: vi.fn().mockResolvedValue({}) },
    terminal: { ...originalApi?.terminal, getAvailableShells: vi.fn().mockResolvedValue([]) },
    agentWorkflows: { ...originalApi?.agentWorkflows, getSettings: vi.fn().mockResolvedValue({
      sourceSettings: { workspaceClaudeCompatibilityEnabled: false, includeProjectClaudeSources: false, includeUserClaudeSources: false, extensionWorkflowsEnabled: false },
      exportSettings: { codexEnabled: false, claudeGeneratedExtensionWorkflowsEnabled: false },
    }) },
    invoke: vi.fn(async (channel: string) => channel === 'attachment-staging:get-settings' ? { mode: 'temp' } : null), onSettingsChanged: (callback: typeof changed) => { changed = callback; return () => {}; } } as typeof window.electronAPI;
  try {
    registerSettingsChangeListener();
    const advanced = render(<Provider store={store}><AdvancedPanel /></Provider>);
    expect(screen.queryByTestId('external-session-follow-setting')).toBeNull();
    expect(screen.queryByText('Follow external agent sessions')).toBeNull();
    advanced.unmount();
    await act(async () => { render(<Provider store={store}><AgentFeaturesPanel /></Provider>); });
    const checkbox = within(screen.getByTestId('external-session-follow-setting')).getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(settingsSet).not.toHaveBeenCalled();
    fireEvent.click(checkbox);
    expect(settingsSet).toHaveBeenLastCalledWith('app.externalSessionFollowEnabled', true);
    expect(checkbox.checked).toBe(false);
    act(() => changed({ key: 'app.externalSessionFollowEnabled', value: true }));
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(settingsSet).toHaveBeenLastCalledWith('app.externalSessionFollowEnabled', false);
    act(() => changed({ key: 'app.externalSessionFollowEnabled', value: false }));
    expect(checkbox.checked).toBe(false);
    expect(settingsSet).toHaveBeenCalledTimes(2);
  } finally {
    window.electronAPI = originalApi;
  }
});

it('shows usage-data collection as off and unswitchable while local-only mode is active', async () => {
  const originalApi = window.electronAPI;
  window.electronAPI = { ...originalApi,
    claudeCode: { ...originalApi?.claudeCode, getSettings: vi.fn().mockResolvedValue({}) },
    terminal: { ...originalApi?.terminal, getAvailableShells: vi.fn().mockResolvedValue([]) },
    invoke: vi.fn(async (channel: string) => channel === 'attachment-staging:get-settings' ? { mode: 'temp' } : null),
  } as typeof window.electronAPI;
  try {
    store.set(localOnly.base, true);
    await act(async () => { render(<Provider store={store}><AdvancedPanel /></Provider>); });

    // The stored preference is on, so only local-only mode can be why it reads off.
    const checkbox = within(screen.getByTestId('usage-data-setting')).getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(true);
  } finally {
    store.set(localOnly.base, false);
    window.electronAPI = originalApi;
  }
});
