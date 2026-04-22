export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Project {
  id: string;
  name: string;
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
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  chat_id: string;
  title: string;
  instructions: string;
  status: TaskStatus;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      projects: { Row: Project; Insert: Omit<Project, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<Project> };
      chats: { Row: Chat; Insert: Omit<Chat, 'id' | 'created_at' | 'context'> & { id?: string; created_at?: string; context?: ChatContextMessage[] }; Update: Partial<Chat> };
      tasks: { Row: Task; Insert: Omit<Task, 'id' | 'created_at' | 'updated_at' | 'status' | 'result' | 'error'> & { id?: string; status?: TaskStatus; result?: string | null; error?: string | null; created_at?: string; updated_at?: string }; Update: Partial<Task> };
    };
  };
}
