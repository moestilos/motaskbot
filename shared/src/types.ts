export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Project {
  id: string;
  name: string;
  working_dir: string | null;
  source: 'manual' | 'claude_code';
  created_at: string;
}

export interface ChatContextMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  task_id?: string;
  at: string;
}

export interface Chat {
  id: string;
  project_id: string;
  name: string;
  context: ChatContextMessage[];
  working_dir: string | null;
  claude_session_id: string | null;
  auto_push: boolean;
  created_at: string;
}

export interface ClaudeSession {
  session_id: string;
  project_dir: string;
  project_label: string;
  preview: string | null;
  message_count: number;
  last_activity_at: string;
  discovered_at: string;
}

export type TaskKind = 'task' | 'chat';

export interface Task {
  id: string;
  project_id: string;
  chat_id: string;
  title: string;
  instructions: string;
  status: TaskStatus;
  result: string | null;
  error: string | null;
  model: string | null;
  kind: TaskKind;
  input_tokens: number | null;
  output_tokens: number | null;
  total_cost_usd: number | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      projects: { Row: Project; Insert: Omit<Project, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<Project> };
      chats: { Row: Chat; Insert: Omit<Chat, 'id' | 'created_at' | 'context'> & { id?: string; created_at?: string; context?: ChatContextMessage[] }; Update: Partial<Chat> };
      tasks: { Row: Task; Insert: Partial<Task> & { project_id: string; chat_id: string; title: string; instructions: string }; Update: Partial<Task> };
      claude_sessions: { Row: ClaudeSession; Insert: ClaudeSession; Update: Partial<ClaudeSession> };
    };
  };
}
