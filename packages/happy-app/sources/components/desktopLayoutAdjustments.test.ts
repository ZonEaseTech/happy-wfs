import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(__dirname, '..');

function read(relativePath: string): string {
    return readFileSync(resolve(sourceRoot, relativePath), 'utf8');
}

describe('desktop layout adjustments', () => {
    it('renders the public share owner metadata in the same header row as the title', () => {
        const source = read('app/(app)/share/[token].tsx');
        expect(source).toContain('ShareHeader');
        expect(source).toContain('styles.shareHeader');
        expect(source).toContain('styles.shareOwnerInline');
        expect(source).toContain("flexWrap: 'nowrap'");
        expect(source).not.toContain('{owner && <OwnerCard owner={owner} />}');

        const layout = read('app/(app)/_layout.tsx');
        expect(layout).toMatch(/name="share\/\[token\]"[\s\S]*?headerShown: false/);
    });

    it('uses a contained desktop dialog for MCP server management instead of a full-page modal', () => {
        const source = read('components/McpServersModal.tsx');
        expect(source).toContain('transparent={true}');
        expect(source).toContain('styles.backdrop');
        expect(source).toContain('styles.dialog');
        expect(source).toContain("height: '72%'");
        expect(source).not.toContain('transparent={false}');
    });

    it('gives large web prompts more desktop width and height', () => {
        const source = read('modal/components/WebPromptModal.tsx');
        expect(source).toContain('LARGE_PROMPT_MAX_WIDTH = 720');
        expect(source).toContain('LARGE_PROMPT_HEIGHT_RATIO = 0.9');
        expect(source).toContain('visibleMultilineRows = config.multiline ? Math.min(config.multilineRows ?? 6, isLargePrompt ? 16 : 8) : 1');
    });

    it('uses the Codex-home Claude .mcp.json target so shared MCP config is visible', () => {
        const source = read('app/(app)/settings/mcpTargets.ts');
        expect(source).toContain("fileName: '.codex/.mcp.json'");
        expect(source).toContain("subtitle: '~/.codex/.mcp.json · mcpServers'");
        expect(source).toContain('codecTarget');
    });

    it('loads older public-share messages when the shared conversation is scrolled upward', () => {
        const page = read('app/(app)/share/[token].tsx');
        expect(page).toContain('hasMore, isLoadingMore, loadMore');
        expect(page).toContain('ListFooterComponent={listFooter}');
        expect(page).toContain('onEndReached={loadMore}');
        expect(page).toContain('maintainVisibleContentPosition');

        const hook = read('hooks/usePublicShareSession.ts');
        expect(hook).toContain('oldestSeqRef');
        expect(hook).toContain('before: oldestSeqRef.current');
        expect(hook).toContain('setMessages((current) =>');

        const api = read('sync/apiSharing.ts');
        expect(api).toContain("url.searchParams.set('before', String(options.before))");
        expect(api).toContain('hasMore: data.hasMore ?? false');
    });


    it('does not show a false failure alert when pending send-now abort is already unavailable', () => {
        const source = read('-session/SessionView.tsx');
        expect(source).toContain('const success = await sync.pinPendingMessage(sessionId, pendingId);');
        expect(source).toContain('await sessionAbort(sessionId);');
        expect(source).toContain("don't show a false failure");
        expect(source).not.toContain(`await sync.pinPendingMessage(sessionId, pendingId);
            await sessionAbort(sessionId);
        } catch {
            Modal.alert`);
    });


    it('batch-sends multiple pending messages instead of sending them one by one', () => {
        const source = read('-session/SessionView.tsx');
        expect(source).toContain('if (pendingMessages.length > 1)');
        expect(source).toContain('buildPendingQueueBatchPrompt(pendingMessages, pendingId)');
        expect(source).toContain('extractPendingUploadedImages(pendingMessages, pendingId)');
        expect(source).toContain('batchImages.length > 0 ? batchImages : undefined');
        expect(source).toContain('pendingMessages.map((message) => sync.deletePendingMessage(sessionId, message.id))');
    });


    it('opens the session terminal as a right resizable panel with user-level quick commands', () => {
        const sessionView = read('-session/SessionView.tsx');
        expect(sessionView).toContain("import { TerminalPanel } from '@/components/Terminal';");
        expect(sessionView).toContain('handleOpenTerminalPanel');
        expect(sessionView).toContain('setTerminalOpenRequestKey((value) => value + 1)');
        expect(sessionView).not.toContain('onPress={() => setShowTerminal(prev => !prev)}');
        expect(sessionView).toContain('<TerminalPanel');
        expect(sessionView).toContain('openRequestKey={terminalOpenRequestKey}');
        expect(sessionView).toContain("<View style={{ flex: 1, minWidth: 0, position: 'relative' }}>");
        expect(sessionView).toContain("flexDirection: 'row'");
        expect(sessionView).not.toContain('showTerminal={showTerminal}');
        expect(sessionView).not.toContain('setShowTerminal={setShowTerminal}');
        const loadedSource = sessionView.slice(sessionView.indexOf('function SessionViewLoaded'));
        expect(loadedSource).not.toContain('<TerminalPanel');
        expect(sessionView).not.toContain(`<Terminal
                visible={showTerminal}`);

        const terminalWeb = read('components/Terminal.web.tsx');
        expect(terminalWeb).toContain('export const TerminalPanel');
        expect(terminalWeb).toContain("window.localStorage?.getItem('terminal.panelWidth')");
        expect(terminalWeb).toContain('width: panelWidth');
        expect(terminalWeb).toContain('handlePanelResizeStart');
        expect(terminalWeb).toContain("borderLeftWidth: 1");
        expect(terminalWeb).toContain("cursor: 'ew-resize'");
        expect(terminalWeb).toContain("useSettingMutable('terminalQuickCommands')");
        expect(terminalWeb).toContain("useSettingMutable('terminalTheme')");
        expect(terminalWeb).toContain('TERMINAL_THEME_COLORS');
        expect(terminalWeb).toContain("terminalTheme={resolvedTerminalTheme}");
        expect(terminalWeb).toContain("background: '#0b0f14'");
        expect(terminalWeb).toContain('quickCommandsOpen');
        expect(terminalWeb).toContain('onClick={() => setQuickCommandsOpen(false)}');
        expect(terminalWeb).toContain('saveQuickCommand');
        expect(terminalWeb).toContain('deleteQuickCommand');
        expect(terminalWeb).toContain('handleRunQuickCommand');
        expect(terminalWeb).toContain('handleClearActiveTerminal');
        expect(terminalWeb).toContain('onClearHandlerChange');
        expect(terminalWeb).toContain("aria-label={t('terminal.clearTerminal')}");
        expect(terminalWeb).toContain('sender(`${command}\\r`);');
        expect(terminalWeb).toContain('terminalTabs');
        expect(terminalWeb).toContain('activeTerminalTabId');
        expect(terminalWeb).toContain('active={isActive}');
        expect(terminalWeb).toContain('handleAddTerminalTab');
        expect(terminalWeb).toContain('handleCloseTerminalTab');
        expect(terminalWeb).toContain('aria-label="New terminal tab"');
        expect(terminalWeb).toContain('aria-label="Close terminal tab"');
        expect(terminalWeb).toContain('terminalLabelFromCwd');
        expect(terminalWeb).toContain('height: 44');
        expect(terminalWeb).toContain('width: 34');
        expect(terminalWeb).toContain('const [hasOpened, setHasOpened] = React.useState(visible);');
        expect(terminalWeb).toContain("display: visible ? 'flex' : 'none'");
        expect(terminalWeb).toContain('type TerminalWorkspace');
        expect(terminalWeb).toContain('createTerminalWorkspace(sessionId, cwd)');
        expect(terminalWeb).toContain('openRequestKey');
        expect(terminalWeb).toContain('activeWorkspaceKey');
        expect(terminalWeb).toContain('processedOpenRequestKeyRef');
        expect(terminalWeb).toContain('openRequestKey <= processedOpenRequestKeyRef.current');
        expect(terminalWeb).toContain('setActiveWorkspaceKey(sessionId)');
        expect(terminalWeb).toContain('if (allWorkspaces.length === 0)');
        expect(terminalWeb).toContain('onClose();');
        expect(terminalWeb).not.toContain('workspaceKey === sessionId) onClose();');
        expect(terminalWeb).toContain('managerOpen');
        expect(terminalWeb).toContain('handleSelectWorkspace');
        expect(terminalWeb).toContain('handleSelectManagedTerminalTab');
        expect(terminalWeb).toContain('onClick={() => handleSelectWorkspace(workspace.key)}');
        expect(terminalWeb).toContain('onClick={() => handleSelectManagedTerminalTab(workspace.key, tab.id)}');
        expect(terminalWeb).toContain('handleCloseWorkspace');
        expect(terminalWeb).toContain('Keep padding off the xterm fit host');
        expect(terminalWeb).toMatch(/ref=\{containerRef\}[\s\S]{0,500}minWidth: 0[\s\S]{0,200}minHeight: 0/);
        expect(terminalWeb).not.toMatch(/ref=\{containerRef\}[\s\S]{0,500}padding: 8/);

        const settings = read('sync/settings.ts');
        expect(settings).toContain('TerminalQuickCommandSchema');
        expect(settings).toContain('terminalQuickCommands: z.array(TerminalQuickCommandSchema)');
        expect(settings).toContain('terminalTheme: TerminalThemeSchema');
        expect(settings).toContain("terminalTheme: 'dark'");
        expect(settings).toContain('terminalQuickCommands: []');

        const appearance = read('app/(app)/settings/appearance.tsx');
        expect(appearance).toContain("useSettingMutable('terminalTheme')");
        expect(appearance).toContain("t('settingsAppearance.terminalTheme')");
    });


    it('uses a dark empty editor area in the file viewer modal', () => {
        const source = read('components/FileViewerModal.web.tsx');
        expect(source).toContain("<View style={{ flex: 1, minWidth: 0, backgroundColor: '#1e1e1e' }}>");
        expect(source).toContain("<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1e1e1e' }}>");
        expect(source).toContain("color: '#8f8f8f'");
    });

    it('falls back to machine read only for absolute image previews outside the session working directory', () => {
        const source = read('components/FileViewerModal.web.tsx');
        expect(source).toContain('const machineReadFallbackId = machineId ?? session?.metadata?.machineId;');
        expect(source).toContain('isPreviewableImage(path)');
        expect(source).toContain('isAbsoluteLocalPath(p)');
        expect(source).toContain('isOutsideWorkingDirectoryError(response.error)');
        expect(source).toContain('return machineReadFile(machineReadFallbackId, p);');
    });

    it('does not route image file previews through the video stream player', () => {
        const source = read('app/(app)/session/[id]/file.tsx');
        expect(source).toContain("const videoPreviewUri = isPreviewVideoFile ? (");
        expect(source).toContain("const localDaemonFileStreamUrl = Platform.OS === 'web' && isPreviewVideoFile");
    });

    it('opens desktop video previews through the local daemon stream instead of base64 reads', () => {
        const source = read('components/FileViewerModal.web.tsx');
        expect(source).toContain('buildLocalDaemonFileStreamUrl');
        expect(source).toContain('const streamUrl = getLocalStreamUrl(path);');
        expect(source).toContain('const machine = machineReadFallbackId ? getMachine(machineReadFallbackId) : undefined;');
        expect(source).toContain('previewUri: streamUrl');
        expect(source).toContain('handleVideoPreviewError(activeTab)');
        expect(source).toContain('src={activeTab.previewUri}');
        expect(source).toContain('crossOrigin="anonymous"');
        expect(source).toContain("objectFit: 'contain'");

        const route = read('app/(app)/session/[id]/file.tsx');
        expect(route).toContain("crossOrigin: 'anonymous'");
        expect(route).toContain('failedVideoStreamPaths');
        expect(route).toContain('handleVideoPreviewError');
        expect(route).toContain('onError={handleVideoPreviewError}');
    });

    it('manages enter-to-send separately for web/desktop and mobile', () => {
        const features = read('app/(app)/settings/features.tsx');
        expect(features).toContain("useSettingMutable('agentInputEnterToSendWeb')");
        expect(features).toContain("useSettingMutable('agentInputEnterToSendMobile')");
        expect(features).toContain("t('settingsFeatures.enterToSendWeb')");
        expect(features).toContain("t('settingsFeatures.enterToSendMobile')");

        const input = read('components/AgentInput.tsx');
        expect(input).toContain("Platform.OS === 'web' ? agentInputEnterToSendWeb : agentInputEnterToSendMobile");

        const settings = read('sync/settings.ts');
        expect(settings).toContain('agentInputEnterToSendWeb: z.boolean()');
        expect(settings).toContain('agentInputEnterToSendMobile: z.boolean()');
        expect(settings).toContain('parsed.data.agentInputEnterToSendWeb ??= parsed.data.agentInputEnterToSend');
        expect(settings).toContain('parsed.data.agentInputEnterToSendMobile ??= parsed.data.agentInputEnterToSend');
    });

    it('exposes a synced configurable GitHub issue start prompt template', () => {
        const prompt = read('components/githubIssueStartPrompt.ts');
        expect(prompt).toContain('applyGitHubIssueStartPromptTemplate');

        const promptTemplate = read('utils/githubIssueStartPromptTemplate.ts');
        expect(promptTemplate).toContain('applyGitHubIssueStartPromptTemplate');
        expect(promptTemplate).toContain('{repo}');
        expect(promptTemplate).toContain('{issueNumber}');
        expect(promptTemplate).toContain('{issueTitle}');
        expect(promptTemplate).toContain('{issueUrl}');

        const settings = read('sync/settings.ts');
        expect(settings).toContain('githubIssueStartPromptTemplate: z.string()');
        expect(settings).toContain('githubIssueStartPromptTemplate: defaultGitHubIssueStartPromptTemplate');

        const sessions = read('components/SessionsList.tsx');
        expect(sessions).toContain("useSetting('githubIssueStartPromptTemplate')");
        expect(sessions).toContain('buildGitHubIssueStartPrompt(issue, githubIssueStartPromptTemplate)');

        const routes = read('components/desktopRoutes/registrations.ts');
        expect(routes).toContain("'/settings/github-issue-start-template'");

        const appLayout = read('app/(app)/_layout.tsx');
        expect(appLayout).toContain('settings/github-issue-start-template');

        const features = read('app/(app)/settings/features.tsx');
        expect(features).toContain("openDesktop('/settings/github-issue-start-template'");
        expect(features).toContain("t('settingsFeatures.githubIssueStartPromptTemplate')");

        const editor = read('app/(app)/settings/github-issue-start-template.tsx');
        expect(editor).toContain("useSettingMutable('githubIssueStartPromptTemplate')");
        expect(editor).toContain('defaultGitHubIssueStartPromptTemplate');
        expect(editor).toContain('TextInput');
        expect(editor).toContain("t('settingsFeatures.restoreDefaultTemplate')");
    });

    it('does not create a wide blank strip between the permanent sidebar and main content', () => {
        const source = read('components/SidebarNavigator.tsx');
        expect(source).toContain('borderRightWidth: 1');
        expect(source).not.toContain('borderRightWidth: 16');
    });


    it('offers a session-scoped allow all tools action in permission prompts', () => {
        const source = read('components/tools/PermissionFooter.tsx');
        expect(source).toContain('handleCodexApproveAllTools');
        expect(source).toContain("sessionAllow(sessionId, permission.id, 'bypassPermissions', undefined, 'approved_for_session')");
        expect(source).toContain("updateSessionPermissionMode(sessionId, 'yolo')");
        expect(source).toContain('handleApproveAllTools');
        expect(source).toContain("sessionAllow(sessionId, permission.id, 'bypassPermissions')");
        expect(source).toContain("t('codex.permissions.yesAllowAllTools')");
        expect(source).toContain("t('claude.permissions.yesAllowAllTools')");

        const zhHans = read('text/translations/zh-Hans.ts');
        expect(zhHans).toContain('是，允许本次会话的所有工具');
    });


    it('shows cached GitHub issue inbox results while refreshing in the background', () => {
        const source = read('components/SessionsList.tsx');
        expect(source).toContain('buildGitHubIssueInboxCacheKey');
        expect(source).toContain("useLocalSettingMutable('githubIssueInboxCache')");
        expect(source).toContain('setPendingIssues(cached.issues)');
        expect(source).toContain('void loadPendingIssues(!cached && !baselineCached)');
        expect(source).toContain('withGitHubIssueInboxCacheEntry');

        const localSettings = read('sync/localSettings.ts');
        expect(localSettings).toContain('githubIssueInboxCache');
        expect(localSettings).toContain('Device-local cached GitHub issue inbox results keyed by filters');
    });


    it('linkifies local file paths inside markdown code blocks', () => {
        const markdown = read('components/markdown/MarkdownView.tsx');
        expect(markdown).toContain('resolveCodeBlockLocalFileReference');
        expect(markdown).toContain('resolveLocalFileReference={resolveCodeBlockLocalFileReference}');

        const highlighter = read('components/SimpleSyntaxHighlighter.tsx');
        expect(highlighter).toContain('localFileReference');
        expect(highlighter).toContain('resolveLocalFileReference');
        expect(highlighter).toContain('<Link');
    });


    it('keeps a baseline GitHub issue list for instant local inbox search while refreshing remotely', () => {
        const source = read('components/SessionsList.tsx');
        expect(source).toContain('pendingIssueBaselineIssues');
        expect(source).toContain('pendingIssueBaselineCacheKey');
        expect(source).toContain('mergeGitHubIssuesForLocalSearch');
        expect(source).toContain('pendingIssueLocalSearchSource');
        expect(source).toContain('loadPendingIssueBaseline');
        expect(source).toContain('void loadPendingIssueBaseline(false)');
        expect(source).toContain('const isBaselineRequest = !pendingIssueSearchText.trim();');
    });


    it('runs exact repository issue lookup in parallel for numeric GitHub issue searches', () => {
        const source = read('components/SessionsList.tsx');
        expect(source).toContain('extractGitHubIssueSearchNumber');
        expect(source).toContain('getGitHubIssueExactSearchRepositories');
        expect(source).toContain("'ZonEaseTech/ttpos-flutter'");
        expect(source).toContain("'ZonEaseTech/ttpos-server-go'");
        expect(source).toContain('startExactGitHubIssueSearch');
        expect(source).toContain('repo:${repository} is:issue ${issueNumber}');
    });


    it('appends quick actions to the existing agent input instead of replacing it', () => {
        const source = read('components/AgentInput.tsx');
        expect(source).toContain("const current = latestTextRef.current ?? props.value ?? '';");
        expect(source).toContain("const separator = current.trim().length > 0 ? '\\n\\n' : '';");
        expect(source).toContain('const nextText = `${current}${separator}${prompt}`;');
        expect(source).toContain('props.onChangeText(nextText);');
        expect(source).not.toContain('props.onChangeText(prompt);');
    });


    it('does not add desktop-only bottom padding on mobile web session view', () => {
        const source = read('-session/SessionView.tsx');
        expect(source).toContain("const sessionContentBottomPadding = safeArea.bottom + (isRunningOnMac() || (Platform.OS === 'web' && deviceType !== 'phone') ? 32 : 0);");
        expect(source).toContain('paddingBottom: sessionContentBottomPadding');
        expect(source).not.toContain("safeArea.bottom + ((isRunningOnMac() || Platform.OS === 'web') ? 32 : 0)");
    });

});
