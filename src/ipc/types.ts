export type PtyOutput =
  | { type: 'Data'; data: string } // base64-encoded
  | {
      type: 'Exit';
      data: { exit_code: number | null; signal: string | null; last_output: string[] };
    };

export interface AgentDef {
  id: string;
  name: string;
  command: string;
  args: string[];
  resume_args: string[];
  skip_permissions_args: string[];
  description: string;
  available?: boolean;
}

export interface CreateTaskResult {
  id: string;
}

export interface TaskInfo {
  id: string;
  name: string;
  agent_ids: string[];
  status: 'Active' | 'Closed';
}
