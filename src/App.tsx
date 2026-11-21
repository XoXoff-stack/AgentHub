import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { oneDark } from '@codemirror/theme-one-dark';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity, AlertCircle, ArrowUp, ArrowUpRight, Check,
  ChevronDown, ChevronRight, CircleHelp, Code2, Command, Copy, Cpu,
  FileCode2, Folder, FolderOpen, FolderPlus, Gauge,
  GitBranch, HardDrive, History, LayoutPanelRight, LoaderCircle, MessageSquare,
  MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Plus, RefreshCw, Search, Settings2, ShieldCheck, Square, Sun,
  Trash2, X, Zap,
} from 'lucide-react';
import type { Agent, Conversation, LocalModel, LocalProvider, Message, ProjectFile } from './lib/types';
import { fileLanguage, formatBytes } from './lib/format';
import { isDesktop } from './lib/types';

type AgentOutput = { processId: string; stream: 'stdout' | 'stderr'; text: string };
type ModelOutput = { conversationId: string; text: string };
type PaletteAction = { label: string; hint: string; icon: typeof Plus; run: () => void };

const providerNames: Record<LocalProvider, string> = { ollama: 'Ollama', lmStudio: 'LM Studio', openAiCompatible: 'OpenAI-compatible' };
const agentIcons: Record<string, string> = {
  'claude-code': '✳', codex: '◈', opencode: '⌘', 'gemini-cli': '✦', aider: '⌁', ollama: '◉', cursor: '◍', windsurf: '≈', 'claude-desktop': '✳',
};

export default function App() {
  const desktop = isDesktop();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [scanState, setScanState] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('ollama');
  const [selectedProvider, setSelectedProvider] = useState<LocalProvider>('ollama');
  const [models, setModels] = useState<LocalModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [modelState, setModelState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [modelError, setModelError] = useState('');
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null);
  const [editorValue, setEditorValue] = useState('');
  const [fileDirty, setFileDirty] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [rightPanel, setRightPanel] = useState<'files' | 'editor' | 'activity'>('files');
  const [activity, setActivity] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lightTheme, setLightTheme] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeProcess, setActiveProcess] = useState<string | null>(null);
  const [backendError, setBackendError] = useState('');
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const outputRef = useRef('');
  const completedProcessesRef = useRef(new Set<string>());
  const activeConversationRef = useRef<Conversation | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { activeConversationRef.current = activeConversation; }, [activeConversation]);

  const pushActivity = useCallback((line: string) => {
    setActivity((current) => [`${new Date().toLocaleTimeString()}  ${line}`, ...current].slice(0, 80));
  }, []);

  const scan = useCallback(async () => {
    if (!desktop) return;
    setScanState('scanning');
    setBackendError('');
    try {
      const result = await invoke<Agent[]>('scan_agents');
      setAgents(result);
      setScanState('done');
      pushActivity(`Scan complete · ${result.length} tool${result.length === 1 ? '' : 's'} detected`);
    } catch (error) {
      setScanState('error');
      setBackendError(String(error));
    }
  }, [desktop, pushActivity]);

  const refreshModels = useCallback(async (provider: LocalProvider) => {
    if (!desktop) return;
    setModelState('loading');
    setModelError('');
    try {
      const result = await invoke<LocalModel[]>('get_local_models', { provider });
      setModels(result);
      setSelectedModel((current) => result.some((model) => model.id === current) ? current : result[0]?.id ?? '');
      setModelState('ready');
      pushActivity(`${providerNames[provider]} · ${result.length} model${result.length === 1 ? '' : 's'} available`);
    } catch (error) {
      setModels([]);
      setModelState('error');
      setModelError(String(error));
    }
  }, [desktop, pushActivity]);

  const loadConversations = useCallback(async () => {
    if (!desktop) return;
    try {
      const result = await invoke<Conversation[]>('list_conversations');
      setConversations(result);
    } catch (error) { setBackendError(String(error)); }
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    void scan();
    void loadConversations();
    void refreshModels('ollama');
  }, [desktop, scan, loadConversations, refreshModels]);

  useEffect(() => {
    if (!desktop) return;
    let unlisten: UnlistenFn[] = [];
    let mounted = true;
    const setup = async () => {
      const output = await listen<AgentOutput>('agent-output', (event) => {
        const item = event.payload;
        outputRef.current += `${item.text}\n`;
        setMessages((current) => current.map((message) => message.streaming
          ? { ...message, content: `${message.content}${message.content ? '\n' : ''}${item.text}` }
          : message));
        if (item.stream === 'stderr') pushActivity(`stderr · ${item.text.slice(0, 130)}`);
      });
      const modelOutput = await listen<ModelOutput>('model-output', (event) => {
        const item = event.payload;
        if (activeConversationRef.current?.id !== item.conversationId) return;
        outputRef.current += item.text;
        setMessages((current) => current.map((message) => message.streaming
          ? { ...message, content: message.content + item.text }
          : message));
      });
      const started = await listen<{ processId: string; agentId: string }>('agent-started', (event) => {
        setActiveProcess(event.payload.processId);
        pushActivity(`${event.payload.agentId} started`);
      });
      const exited = await listen<{ processId: string; conversationId: string; code: number | null; cancelled?: boolean }>('agent-exit', async (event) => {
        completedProcessesRef.current.add(event.payload.processId);
        setActiveProcess((current) => current === event.payload.processId ? null : current);
        setBusy(false);
        const content = outputRef.current.trim() || (event.payload.cancelled ? 'Stopped by user.' : `Process finished with exit code ${event.payload.code ?? 'unknown'}.`);
        const conversation = activeConversationRef.current;
        if (conversation?.id === event.payload.conversationId && content) {
          try { await invoke('save_message', { conversationId: conversation.id, role: 'assistant', content }); } catch { /* UI remains usable when storage is unavailable. */ }
        }
        setMessages((current) => current.map((message) => message.streaming ? { ...message, streaming: false } : message));
        outputRef.current = '';
        pushActivity(event.payload.cancelled ? 'Agent process stopped by user' : `Agent process ended · exit ${event.payload.code ?? 'unknown'}`);
        void loadConversations();
      });
      const modelFinished = await listen<{ conversationId: string }>('model-finished', async (event) => {
        const conversation = activeConversationRef.current;
        if (conversation?.id !== event.payload.conversationId) return;
        setBusy(false);
        const content = outputRef.current;
        if (content.trim()) {
          try { await invoke('save_message', { conversationId: conversation.id, role: 'assistant', content }); } catch { /* Keep the streamed answer visible. */ }
        }
        setMessages((current) => current.map((message) => message.streaming ? { ...message, streaming: false } : message));
        outputRef.current = '';
        void loadConversations();
      });
      if (mounted) unlisten = [output, modelOutput, started, exited, modelFinished];
      else [output, modelOutput, started, exited, modelFinished].forEach((fn) => fn());
    };
    void setup();
    return () => { mounted = false; unlisten.forEach((fn) => fn()); };
  }, [desktop, loadConversations, pushActivity]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const createConversation = useCallback(async () => {
    if (busy) return;
    if (!desktop) {
      setBackendError('Open the AgentHub desktop app to create a persistent conversation.');
      return;
    }
    try {
      const conversation = await invoke<Conversation>('create_conversation', {
        title: 'New conversation', agentId: selectedAgent, projectPath,
      });
      setConversations((current) => [conversation, ...current]);
      setActiveConversation(conversation);
      activeConversationRef.current = conversation;
      setMessages([]);
      setDraft('');
      pushActivity('New conversation created');
    } catch (error) { setBackendError(String(error)); }
  }, [desktop, projectPath, pushActivity, selectedAgent, busy]);

  const refreshProject = useCallback(async (path: string) => {
    if (!desktop) return;
    try { setFiles(await invoke<ProjectFile[]>('project_list_files', { root: path })); }
    catch (error) { setBackendError(String(error)); }
  }, [desktop]);


  const chooseAgent = useCallback(async (agentId: string, provider?: LocalProvider) => {
    if (busy) return;
    setSelectedAgent(agentId);
    if (provider) {
      setSelectedProvider(provider);
      void refreshModels(provider);
    }
    if (!desktop || !activeConversation || activeConversation.agentId === agentId) return;
    const updated = { ...activeConversation, agentId };
    setActiveConversation(updated);
    activeConversationRef.current = updated;
    setConversations((current) => current.map((item) => item.id === updated.id ? updated : item));
    try {
      await invoke('update_conversation_agent', { conversationId: updated.id, agentId });
    } catch (error) {
      setBackendError(String(error));
    }
  }, [busy, desktop, activeConversation, refreshModels]);

  const openConversation = useCallback(async (conversation: Conversation) => {
    if (busy) return;
    setActiveConversation(conversation);
    activeConversationRef.current = conversation;
    setSelectedAgent(conversation.agentId);
    if (conversation.agentId === 'ollama') {
      setSelectedProvider('ollama');
      void refreshModels('ollama');
    } else if (conversation.agentId === 'lm-studio') {
      setSelectedProvider('lmStudio');
      void refreshModels('lmStudio');
    }
    setProjectPath(conversation.projectPath);
    setMessages([]);
    setSelectedFile(null);
    setEditorValue('');
    if (!conversation.projectPath) setFiles([]);
    if (!desktop) return;
    try {
      const stored = await invoke<Message[]>('get_conversation', { conversationId: conversation.id });
      setMessages(stored);
    } catch (error) { setBackendError(String(error)); }
    if (conversation.projectPath) await refreshProject(conversation.projectPath);
  }, [desktop, busy, refreshProject, refreshModels]);

  const chooseProject = useCallback(async () => {
    if (!desktop) {
      setBackendError('Open the AgentHub desktop app to browse local project files.');
      return;
    }
    if (busy) return;
    const chosen = await open({ directory: true, multiple: false, title: 'Open project folder' });
    if (typeof chosen !== 'string') return;
    setProjectPath(chosen);
    setSelectedFile(null);
    setEditorValue('');
    await refreshProject(chosen);
    if (activeConversation) {
      const updated = { ...activeConversation, projectPath: chosen };
      setActiveConversation(updated);
      activeConversationRef.current = updated;
      setConversations((current) => current.map((item) => item.id === updated.id ? updated : item));
      if (desktop) {
        try { await invoke('update_conversation_project', { conversationId: updated.id, projectPath: chosen }); }
        catch (error) { setBackendError(String(error)); }
      }
    }
    pushActivity(`Project opened · ${chosen}`);
  }, [desktop, busy, activeConversation, pushActivity, refreshProject]);

  const openFile = useCallback(async (file: ProjectFile) => {
    if (!desktop || !projectPath || file.isDirectory) return;
    try {
      const content = await invoke<string>('project_read_file', { root: projectPath, relativePath: file.path });
      setSelectedFile(file);
      setEditorValue(content);
      setFileDirty(false);
      setRightPanel('editor');
    } catch (error) { setBackendError(String(error)); }
  }, [desktop, projectPath]);

  const saveFile = useCallback(async () => {
    if (!desktop || !projectPath || !selectedFile) return;
    setFileSaving(true);
    try {
      await invoke('project_write_file', { root: projectPath, relativePath: selectedFile.path, content: editorValue });
      setFileDirty(false);
      pushActivity(`Saved · ${selectedFile.path}`);
    } catch (error) { setBackendError(String(error)); }
    finally { setFileSaving(false); }
  }, [desktop, projectPath, selectedFile, editorValue, pushActivity]);

  const sendMessage = useCallback(async () => {
    const prompt = draft.trim();
    if (!prompt || busy) return;
    if (!desktop) {
      setBackendError('The preview runs in a browser. Open the desktop build to connect local agents and models.');
      return;
    }
    let conversation = activeConversation;
    if (!conversation) {
      try {
        conversation = await invoke<Conversation>('create_conversation', {
          title: prompt.slice(0, 36), agentId: selectedAgent, projectPath,
        });
        setActiveConversation(conversation);
        activeConversationRef.current = conversation;
        setConversations((current) => [conversation!, ...current]);
      } catch (error) { setBackendError(String(error)); return; }
    }
    if (conversation.title === 'New conversation') {
      const title = prompt.replace(/\s+/g, ' ').slice(0, 42);
      conversation = { ...conversation, title };
      setActiveConversation(conversation);
      activeConversationRef.current = conversation;
      setConversations((current) => current.map((item) => item.id === conversation!.id ? conversation! : item));
      try { await invoke('rename_conversation', { conversationId: conversation.id, title }); } catch { /* The messages remain saved even if rename fails. */ }
    }
    const userMessage: Message = {
      id: crypto.randomUUID(), conversationId: conversation.id, role: 'user', content: prompt,
      createdAt: new Date().toISOString(),
    };
    const assistantMessage: Message = {
      id: crypto.randomUUID(), conversationId: conversation.id, role: 'assistant', content: '',
      createdAt: new Date().toISOString(), streaming: true,
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setDraft('');
    setBusy(true);
    outputRef.current = '';
    try {
      await invoke('save_message', { conversationId: conversation.id, role: 'user', content: prompt });
      if (selectedAgent === 'ollama' || selectedAgent === 'lm-studio' || selectedAgent === 'openai-compatible') {
        const provider: LocalProvider = selectedAgent === 'ollama' ? 'ollama' : selectedAgent === 'lm-studio' ? 'lmStudio' : 'openAiCompatible';
        await invoke('send_local_chat', {
          request: {
            provider, model: selectedModel, prompt, conversationId: conversation.id,
            history: messages.map((message) => ({ role: message.role, content: message.content })),
          },
        });
      } else {
        const processId = await invoke<string>('run_agent', {
          request: { agentId: selectedAgent, prompt, projectPath, conversationId: conversation.id },
        });
        if (!completedProcessesRef.current.has(processId)) setActiveProcess(processId);
      }
    } catch (error) {
      const errorText = String(error);
      setMessages((current) => current.map((message) => message.id === assistantMessage.id
        ? { ...message, content: errorText, streaming: false, error: true }
        : message));
      setBusy(false);
      setActiveProcess(null);
      outputRef.current = '';
      setBackendError(errorText);
      pushActivity(`Request failed · ${errorText.slice(0, 140)}`);
    }
  }, [draft, busy, desktop, activeConversation, selectedAgent, projectPath, selectedModel, messages, pushActivity]);

  const stopGeneration = useCallback(async () => {
    if (!desktop || !activeProcess) return;
    try { await invoke('stop_agent', { processId: activeProcess }); }
    catch (error) { setBackendError(String(error)); }
  }, [desktop, activeProcess]);

  const removeConversation = useCallback(async (id: string) => {
    if (!desktop || busy) return;
    try {
      await invoke('delete_conversation', { conversationId: id });
      setConversations((current) => current.filter((item) => item.id !== id));
      if (activeConversation?.id === id) {
        setActiveConversation(null);
        activeConversationRef.current = null;
        setMessages([]);
      }
      setConfirmDelete(null);
    } catch (error) { setBackendError(String(error)); }
  }, [desktop, activeConversation, busy]);

  const actions: PaletteAction[] = useMemo(() => [
    { label: 'New conversation', hint: 'Create a fresh thread', icon: Plus, run: () => void createConversation() },
    { label: 'Open project', hint: 'Choose a local folder', icon: FolderOpen, run: () => void chooseProject() },
    { label: 'Scan for agents', hint: 'Detect installed tools', icon: RefreshCw, run: () => void scan() },
    { label: 'Refresh local models', hint: 'Query the selected model server', icon: Cpu, run: () => void refreshModels(selectedProvider) },
    { label: 'Toggle right panel', hint: 'Show or hide developer tools', icon: LayoutPanelRight, run: () => setRightOpen((current) => !current) },
    { label: 'Settings', hint: 'Appearance and application info', icon: Settings2, run: () => setSettingsOpen(true) },
  ], [createConversation, chooseProject, scan, refreshModels, selectedProvider]);
  const filteredActions = actions.filter((item) => item.label.toLowerCase().includes(paletteQuery.toLowerCase()));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setPaletteOpen((current) => !current); setPaletteQuery('');
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault(); void createConversation();
      }
      if (event.key === 'Escape') { setPaletteOpen(false); setSettingsOpen(false); setShowAgentMenu(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createConversation]);

  const availableAgents = agents.filter((agent) => agent.compatible && agent.integration === 'cli');
  const agentLabel = selectedAgent === 'ollama' || selectedAgent === 'lm-studio' || selectedAgent === 'openai-compatible'
    ? `${providerNames[selectedAgent === 'ollama' ? 'ollama' : selectedAgent === 'lm-studio' ? 'lmStudio' : 'openAiCompatible']} · ${selectedModel || 'Select a model'}`
    : agents.find((agent) => agent.id === selectedAgent)?.name ?? 'Choose an agent';
  const visibleConversations = conversations.filter((item) => item.title.toLowerCase().includes(search.toLowerCase()));
  const extensions = useMemo(() => {
    const language = selectedFile ? fileLanguage(selectedFile.path) : 'text';
    if (language === 'json') return [json()];
    if (language === 'markdown') return [markdown()];
    if (language === 'python') return [python()];
    if (language === 'rust') return [rust()];
    if (language === 'javascript' || language === 'typescript' || language === 'tsx' || language === 'jsx') return [javascript({ jsx: language === 'tsx' || language === 'jsx', typescript: language === 'typescript' || language === 'tsx' })];
    return [];
  }, [selectedFile]);

  return (
    <div className={`app-shell ${lightTheme ? 'light-theme' : ''}`}>
      <header className="titlebar">
        <div className="titlebar-brand"><div className="brand-mark"><span /></div><span>AgentHub</span><span className="brand-version">0.1.0</span></div>
        <div className="titlebar-center"><span className="window-dot" /><span>Every AI. One Hub.</span></div>
        <div className="titlebar-actions">
          <button className="icon-button titlebar-icon" onClick={() => setPaletteOpen(true)} title="Command palette"><Command size={15} /></button>
          <button className="icon-button titlebar-icon" onClick={() => setSettingsOpen(true)} title="Settings"><Settings2 size={15} /></button>
          <div className="titlebar-divider" />
          <button className="icon-button titlebar-icon" onClick={() => setSidebarOpen((current) => !current)} title="Toggle sidebar">{sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}</button>
          <button className="icon-button titlebar-icon" onClick={() => setRightOpen((current) => !current)} title="Toggle developer panel">{rightOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}</button>
        </div>
      </header>

      <div className="workspace">
        <AnimatePresence initial={false}>
          {sidebarOpen && <motion.aside className="sidebar" initial={{ width: 0, opacity: 0 }} animate={{ width: 252, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.18 }}>
            <div className="sidebar-scroll">
              <div className="sidebar-top-actions">
                <button className="new-chat-button" onClick={() => void createConversation()}><Plus size={15} /><span>New conversation</span><kbd>⌘ N</kbd></button>
                <button className="secondary-action" onClick={() => void chooseProject()}><FolderOpen size={15} /><span>Open project</span></button>
              </div>

              <div className="sidebar-section">
                <div className="section-heading"><span>WORKSPACE</span></div>
                <div className="search-wrap"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" /></div>
                <div className="nav-item"><History size={14} /><span>Recent</span><span className="nav-count">{conversations.length || ''}</span></div>
                {visibleConversations.slice(0, 8).map((conversation) => (
                  <div key={conversation.id} className={`conversation-item ${activeConversation?.id === conversation.id ? 'active' : ''}`}>
                    <button onClick={() => void openConversation(conversation)}><MessageSquare size={13} /><span>{conversation.title}</span></button>
                    <button className="conversation-more" onClick={() => setConfirmDelete(conversation.id)} title="Delete conversation" disabled={busy}><MoreHorizontal size={14} /></button>
                  </div>
                ))}
                {visibleConversations.length === 0 && <div className="empty-sidebar">No conversations yet</div>}
              </div>

              <div className="sidebar-section agent-section">
                <div className="section-heading"><span>AI TOOLS</span><button className={`tiny-icon ${scanState === 'scanning' ? 'spinning' : ''}`} onClick={() => void scan()} title="Scan installed tools"><RefreshCw size={13} /></button></div>
                {availableAgents.map((agent) => (
                  <button key={agent.id} className={`agent-nav-item ${selectedAgent === agent.id ? 'selected' : ''}`} onClick={() => void chooseAgent(agent.id)}>
                    <span className={`agent-symbol agent-${agent.id}`}>{agentIcons[agent.id] ?? '✧'}</span><span>{agent.name}</span><span className={`status-dot ${agent.status === 'available' ? '' : 'muted'}`} />
                  </button>
                ))}
                {agents.filter((agent) => agent.integration === 'gui-only' || agent.integration === 'detection-only').map((agent) => (
                  <div key={agent.id} className="agent-nav-item disabled-agent" title={agent.detail}><span className="agent-symbol">{agentIcons[agent.id] ?? '◌'}</span><span>{agent.name}</span><span className="compat-label">{agent.integration === 'detection-only' ? 'Limited' : 'App'}</span></div>
                ))}
                {scanState === 'scanning' && <div className="scan-caption"><LoaderCircle size={11} className="spin" /> Scanning PATH…</div>}
                {scanState === 'done' && agents.length === 0 && <div className="scan-caption">No supported CLI tools found.</div>}
                {scanState === 'idle' && <div className="scan-caption">Connect your local tools to get started.</div>}
                <button className="text-action" onClick={() => void scan()} disabled={!desktop || scanState === 'scanning'}><RefreshCw size={12} /> Scan for tools</button>
              </div>

              <div className="sidebar-section local-section">
                <div className="section-heading"><span>LOCAL MODELS</span><button className={`tiny-icon ${modelState === 'loading' ? 'spinning' : ''}`} onClick={() => void refreshModels(selectedProvider)} title="Refresh models" disabled={!desktop || modelState === 'loading'}><RefreshCw size={13} /></button></div>
                <button className={`agent-nav-item ${selectedAgent === 'ollama' ? 'selected' : ''}`} onClick={() => void chooseAgent('ollama', 'ollama')} disabled={!desktop || busy}><span className="agent-symbol ollama-symbol">◉</span><span>Ollama</span><span className={`status-dot ${modelState === 'ready' && selectedProvider === 'ollama' ? '' : 'muted'}`} /></button>
                <button className={`agent-nav-item ${selectedAgent === 'lm-studio' ? 'selected' : ''}`} onClick={() => void chooseAgent('lm-studio', 'lmStudio')} disabled={!desktop || busy}><span className="agent-symbol lm-symbol">▣</span><span>LM Studio</span><span className={`status-dot ${modelState === 'ready' && selectedProvider === 'lmStudio' ? '' : 'muted'}`} /></button>
                {modelState === 'ready' && models.length > 0 && <div className="model-inline">{models.length} model{models.length === 1 ? '' : 's'} · {selectedModel || 'none selected'}</div>}
                {modelState === 'error' && <div className="model-inline model-error">Server unavailable</div>}
              </div>
            </div>
            <div className="sidebar-footer">
              <button className="profile-button" onClick={() => setSettingsOpen(true)}><div className="profile-avatar">A</div><div className="profile-info"><strong>Local workspace</strong><span>{desktop ? 'On this device' : 'Browser preview'}</span></div><Settings2 size={15} /></button>
            </div>
          </motion.aside>}
        </AnimatePresence>

        <main className="main-panel">
          <div className="main-toolbar">
            <div className="breadcrumbs"><span className="crumb-muted">Workspace</span><ChevronRight size={13} /><span>{activeConversation?.title ?? 'New session'}</span>{projectPath && <><span className="crumb-separator">·</span><span className="project-crumb"><Folder size={12} />{projectPath.split(/[\\/]/).filter(Boolean).pop()}</span></>}</div>
            <div className="toolbar-right"><span className="connection-indicator"><span className={desktop ? 'connection-dot online' : 'connection-dot'} />{desktop ? 'Local runtime' : 'Preview mode'}</span><button className="toolbar-icon" onClick={() => setRightOpen((current) => !current)}><LayoutPanelRight size={15} /></button></div>
          </div>

          <div className="conversation-scroll">
            {messages.length === 0 ? (
              <div className="welcome-screen">
                <div className="welcome-orb"><div className="orb-inner"><span /></div><i className="orb-ring ring-one" /><i className="orb-ring ring-two" /></div>
                <div className="eyebrow"><span className="eyebrow-line" /> YOUR AI WORKSPACE <span className="eyebrow-line" /></div>
                <h1>One hub.<br /><span>Every intelligence.</span></h1>
                <p>Bring your AI coding tools together. Pick an agent, open a project, and build something great.</p>
                <div className="suggestion-grid">
                  <button onClick={() => { setDraft('Explain the architecture of this project and suggest improvements.'); draftRef.current?.focus(); }}><Code2 size={16} /><span><strong>Understand a codebase</strong><small>Explore a project with an agent</small></span><ArrowUpRight size={14} /></button>
                  <button onClick={() => { setDraft('Help me plan and implement a new feature.'); draftRef.current?.focus(); }}><Zap size={16} /><span><strong>Build a feature</strong><small>Turn an idea into working code</small></span><ArrowUpRight size={14} /></button>
                  <button onClick={() => { setDraft('Review this code for bugs and improvements.'); draftRef.current?.focus(); }}><ShieldCheck size={16} /><span><strong>Review code</strong><small>Find issues and improve quality</small></span><ArrowUpRight size={14} /></button>
                  <button onClick={() => void chooseProject()}><FolderOpen size={16} /><span><strong>Open a project</strong><small>Connect a local workspace</small></span><ArrowUpRight size={14} /></button>
                </div>
                {!desktop && <div className="preview-notice"><AlertCircle size={14} /> Desktop runtime required to scan local tools and run models.</div>}
              </div>
            ) : (
              <div className="message-list">
                {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <div className="composer-area">
            {backendError && <div className="inline-error"><AlertCircle size={13} /><span>{backendError}</span><button onClick={() => setBackendError('')}><X size={13} /></button></div>}
            {modelError && (selectedAgent === 'ollama' || selectedAgent === 'lm-studio') && <div className="inline-error subtle-error"><AlertCircle size={13} /><span>{modelError}</span><button onClick={() => void refreshModels(selectedProvider)}><RefreshCw size={12} /></button></div>}
            <div className="composer-box">
              <textarea ref={draftRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask your agent anything…" rows={2} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} />
              <div className="composer-bottom">
                <div className="composer-tools">
                  <div className="agent-select-wrap">
                    <button className="agent-select" onClick={() => setShowAgentMenu((current) => !current)}><span className="select-spark">✧</span>{agentLabel}<ChevronDown size={12} /></button>
                    <AnimatePresence>{showAgentMenu && <motion.div className="agent-menu" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}>
                      <div className="menu-label">LOCAL MODELS</div>
                      <button onClick={() => { void chooseAgent('ollama', 'ollama'); setShowAgentMenu(false); }}><span className="agent-symbol ollama-symbol">◉</span>Ollama</button>
                      <button onClick={() => { void chooseAgent('lm-studio', 'lmStudio'); setShowAgentMenu(false); }}><span className="agent-symbol lm-symbol">▣</span>LM Studio</button>
                      <div className="menu-divider" /><div className="menu-label">AI AGENTS</div>
                      {availableAgents.map((agent) => <button key={agent.id} onClick={() => { void chooseAgent(agent.id); setShowAgentMenu(false); }}><span className="agent-symbol">{agentIcons[agent.id] ?? '✧'}</span>{agent.name}</button>)}
                      {availableAgents.length === 0 && <div className="menu-empty">No supported CLI agents detected</div>}
                    </motion.div>}</AnimatePresence>
                  </div>
                  {(selectedAgent === 'ollama' || selectedAgent === 'lm-studio' || selectedAgent === 'openai-compatible') && <select className="model-select" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} aria-label="Model">
                    <option value="">Choose model</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                  </select>}
                  <button className={`project-chip ${projectPath ? 'project-chip-active' : ''}`} onClick={() => void chooseProject()}><Folder size={13} />{projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : 'Add context'}<Plus size={11} /></button>
                </div>
                <div className="composer-submit">
                  <span className="send-hint">↵ to send · shift ↵ for newline</span>
                  {busy ? (activeProcess ? <button className="stop-button" onClick={() => void stopGeneration()} title="Stop generation"><Square size={13} fill="currentColor" /></button> : <button className="stop-button" disabled title="Local model request is running"><LoaderCircle size={14} className="spin" /></button>) : <button className="send-button" onClick={() => void sendMessage()} disabled={!draft.trim() || ((selectedAgent === 'ollama' || selectedAgent === 'lm-studio' || selectedAgent === 'openai-compatible') && !selectedModel)} title="Send message"><ArrowUp size={17} /></button>}
                </div>
              </div>
            </div>
            <div className="composer-disclaimer">AgentHub uses the tools installed on your computer. Your project stays local unless an agent sends data to its own provider.</div>
          </div>
        </main>

        <AnimatePresence initial={false}>
          {rightOpen && <motion.aside className="developer-panel" initial={{ width: 0, opacity: 0 }} animate={{ width: 330, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.18 }}>
            <div className="developer-tabs"><button className={rightPanel === 'files' ? 'active' : ''} onClick={() => setRightPanel('files')}><Folder size={13} />Files</button><button className={rightPanel === 'editor' ? 'active' : ''} onClick={() => setRightPanel('editor')}><Code2 size={13} />Editor</button><button className={rightPanel === 'activity' ? 'active' : ''} onClick={() => setRightPanel('activity')}><Activity size={13} />Activity</button></div>
            {rightPanel === 'files' && <div className="panel-content files-panel">
              <div className="panel-heading"><div><span className="panel-eyebrow">PROJECT</span><strong>{projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : 'No folder open'}</strong></div><div className="panel-heading-actions"><button className="tiny-icon" onClick={() => projectPath && void refreshProject(projectPath)} title="Refresh files" disabled={!desktop || !projectPath || busy}><RefreshCw size={13} /></button><button className="tiny-icon" onClick={() => void chooseProject()} title="Open folder" disabled={!desktop || busy}><FolderPlus size={14} /></button></div></div>
              {projectPath ? <><div className="project-path-label" title={projectPath}>{projectPath}</div><div className="file-tree">{files.length === 0 ? <div className="panel-empty">This folder is empty.</div> : files.map((file) => <button key={file.path} className={`file-row ${selectedFile?.path === file.path ? 'selected' : ''} ${file.isDirectory ? 'directory' : ''}`} style={{ paddingLeft: 12 + (file.path.split(/[\\/]/).length - 1) * 15 }} onClick={() => void openFile(file)} disabled={file.isDirectory} title={file.isDirectory ? 'Folder navigation is not available in this version' : 'Open file'}><span className="file-icon">{file.isDirectory ? <Folder size={13} /> : <FileCode2 size={13} />}</span><span className="file-name">{file.name}</span>{!file.isDirectory && <span className="file-size">{formatBytes(file.size)}</span>}</button>)}</div></> : <div className="panel-empty panel-empty-large"><FolderOpen size={24} /><span>Open a project to browse its files.</span><button onClick={() => void chooseProject()}>Choose folder</button></div>}
            </div>}
            {rightPanel === 'editor' && <div className="editor-panel">
              {selectedFile ? <><div className="editor-header"><div className="editor-file-name"><FileCode2 size={13} />{selectedFile.name}{fileDirty && <span className="dirty-dot" />}</div><button className="save-button" onClick={() => void saveFile()} disabled={!fileDirty || fileSaving}>{fileSaving ? <LoaderCircle size={12} className="spin" /> : <Check size={12} />} Save</button></div><CodeMirror value={editorValue} height="100%" theme={lightTheme ? 'light' : oneDark} extensions={extensions} onChange={(value) => { setEditorValue(value); setFileDirty(true); }} basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, bracketMatching: true, autocompletion: true }} /></> : <div className="panel-empty panel-empty-large"><Code2 size={24} /><span>Select a file to edit it here.</span></div>}
            </div>}
            {rightPanel === 'activity' && <div className="panel-content activity-panel"><div className="panel-heading"><div><span className="panel-eyebrow">RUNTIME</span><strong>Activity log</strong></div><button className="tiny-icon" onClick={() => setActivity([])} title="Clear activity"><Trash2 size={13} /></button></div>{activeProcess && <div className="running-card"><span className="running-pulse" /><div><strong>Agent running</strong><small>{activeProcess.slice(0, 8)}</small></div><button onClick={() => void stopGeneration()}><Square size={12} /></button></div>}{activity.length === 0 ? <div className="panel-empty">No activity yet.</div> : <div className="activity-list">{activity.map((line, index) => <div key={`${line}-${index}`} className="activity-line">{line}</div>)}</div>}</div>}
          </motion.aside>}
        </AnimatePresence>
      </div>

      <footer className="statusbar"><div className="status-left"><span><span className={`status-dot ${desktop ? '' : 'muted'}`} />{desktop ? 'AgentHub runtime ready' : 'Browser preview'}</span><span><GitBranch size={12} />{projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() : 'No project'}</span></div><div className="status-right"><span><HardDrive size={12} />Local-first</span><span><Gauge size={12} />v0.1.0</span><button onClick={() => setSettingsOpen(true)}><CircleHelp size={12} />Help</button></div></footer>

      <AnimatePresence>{paletteOpen && <motion.div className="modal-backdrop palette-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}><motion.div className="command-palette" initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }}><div className="palette-search"><Search size={17} /><input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Type a command or search…" /><kbd>ESC</kbd></div><div className="palette-results">{filteredActions.map((item) => <button key={item.label} onClick={() => { item.run(); setPaletteOpen(false); }}><span className="palette-icon"><item.icon size={15} /></span><span><strong>{item.label}</strong><small>{item.hint}</small></span><ArrowUpRight size={13} /></button>)}{filteredActions.length === 0 && <div className="palette-empty">No commands found</div>}</div><div className="palette-footer"><span>AGENTHUB COMMANDS</span><span><kbd>↑</kbd><kbd>↓</kbd> Navigate <kbd>↵</kbd> Select</span></div></motion.div></motion.div>}</AnimatePresence>

      <AnimatePresence>{settingsOpen && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><motion.div className="settings-modal" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}><div className="modal-header"><div><span className="panel-eyebrow">PREFERENCES</span><h2>Settings</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)}><X size={16} /></button></div><div className="settings-content"><div className="settings-row"><div className="settings-icon"><Sun size={16} /></div><div className="settings-copy"><strong>Appearance</strong><span>Choose the interface theme.</span></div><button className={`toggle ${lightTheme ? 'on' : ''}`} onClick={() => setLightTheme((current) => !current)}><span /></button><span className="setting-value">{lightTheme ? 'Light' : 'Dark'}</span></div><div className="settings-row"><div className="settings-icon"><Cpu size={16} /></div><div className="settings-copy"><strong>Runtime</strong><span>{desktop ? 'Desktop backend connected.' : 'Browser preview only.'}</span></div><span className="setting-value">{desktop ? 'Connected' : 'Preview'}</span></div><div className="settings-row"><div className="settings-icon"><ShieldCheck size={16} /></div><div className="settings-copy"><strong>Data storage</strong><span>Conversations are stored locally in SQLite.</span></div><span className="setting-value">Local</span></div><div className="settings-about"><div className="brand-mark"><span /></div><div><strong>AgentHub</strong><span>The Universal AI Agent Launcher · 0.1.0</span></div></div></div><div className="modal-footer"><span>Every AI. One Hub.</span><button className="modal-done" onClick={() => setSettingsOpen(false)}>Done</button></div></motion.div></motion.div>}</AnimatePresence>

      <AnimatePresence>{confirmDelete && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div className="confirm-modal" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}><div className="confirm-icon"><Trash2 size={18} /></div><h3>Delete conversation?</h3><p>This permanently removes the conversation and its messages from this device.</p><div className="confirm-actions"><button onClick={() => setConfirmDelete(null)}>Cancel</button><button className="danger-button" onClick={() => void removeConversation(confirmDelete)} disabled={busy}>Delete conversation</button></div></motion.div></motion.div>}</AnimatePresence>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <motion.div className={`message-row ${message.role === 'user' ? 'user-message' : 'assistant-message'}`} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }}>
      <div className="message-avatar">{message.role === 'user' ? 'Y' : <div className="mini-brand"><span /></div>}</div>
      <div className="message-body"><div className="message-meta"><strong>{message.role === 'user' ? 'You' : 'AgentHub'}</strong><span>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>{message.streaming && <span className="streaming-label"><span />Generating</span>}</div>
        {message.error ? <div className="message-error"><AlertCircle size={14} />{message.content}</div> : <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || (message.streaming ? ' ' : '')}</ReactMarkdown>{message.streaming && !message.content && <span className="typing-indicator"><i /><i /><i /></span>}</div>}
        {message.role === 'assistant' && message.content && !message.streaming && <button className="copy-message" onClick={() => void copy()}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}</button>}
      </div>
    </motion.div>
  );
}
