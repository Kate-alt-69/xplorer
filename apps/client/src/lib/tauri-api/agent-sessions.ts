/**
 * TauriAPI bindings for the multi-session agent runtime.
 * Wraps SDK calls for creating, listing, stopping, and removing agent sessions.
 */

import { AgentSessions } from '@xplorer/sdk';

export const createAgentSession = AgentSessions.createAgentSession;
export const listAgentSessions = AgentSessions.listAgentSessions;
export const getAgentSession = AgentSessions.getAgentSession;
export const stopAgentSession = AgentSessions.stopAgentSession;
export const removeAgentSession = AgentSessions.removeAgentSession;
