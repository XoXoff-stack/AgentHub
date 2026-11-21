export type Agent = {
  id: string;
  name: string;
  executable: string | null;
  version: string | null;
  integration: 'cli' | 'local-api' | 'gui-only' | string;
  status: 'detected' | 'available' | 'running' | 'error' | string;
  compatible: boolean;
  detail: string;
};

export type Conversation = {
  id: string;
  title: string;
  agentId: string;
  projectPath: string | null;
  updatedAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  streaming?: boolean;
  error?: boolean;
};

export type ProjectFile = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number | null;
};

export type LocalModel = { id: string; name: string; size: number | null };
export type LocalProvider = 'ollama' | 'lmStudio' | 'openAiCompatible';

export const isDesktop = () => '__TAURI_INTERNALS__' in window;
