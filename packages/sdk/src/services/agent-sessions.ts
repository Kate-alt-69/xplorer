import { transport } from '../transport';
import type {
  AgentSessionSummary,
  CreateSessionParams,
} from '../../../../apps/client/src/lib/tauri-api-types';

export const createAgentSession = async (
  params: CreateSessionParams,
): Promise<AgentSessionSummary> => await transport('create_agent_session', { params });

export const listAgentSessions = async (): Promise<AgentSessionSummary[]> =>
  await transport('list_agent_sessions');

export const getAgentSession = async (sessionId: string): Promise<AgentSessionSummary> =>
  await transport('get_agent_session', { sessionId });

export const stopAgentSession = async (sessionId: string): Promise<void> =>
  await transport('stop_agent_session', { sessionId });

export const removeAgentSession = async (sessionId: string): Promise<void> =>
  await transport('remove_agent_session', { sessionId });
