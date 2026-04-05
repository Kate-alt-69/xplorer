/**
 * Conversation branching system for the AI chat agent.
 * Allows users to fork conversations from any message, creating
 * parallel exploration paths without losing the original thread.
 *
 * Each branch is a separate conversation that shares history up to
 * the fork point. Branches are displayed as tabs above the chat.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationBranch {
  /** Unique branch id */
  id: string;
  /** Human-readable label */
  label: string;
  /** Index of the message in the parent branch where this fork was created */
  forkPointIndex: number;
  /** Id of the parent branch (null for the root/main branch) */
  parentBranchId: string | null;
  /** Messages from the fork point onward (branch-specific messages) */
  messages: BranchMessage[];
  /** When this branch was created */
  createdAt: number;
}

export interface BranchMessage {
  role: string;
  content: string;
  isContextInjection?: boolean;
  droppedFiles?: Array<{ name: string; path: string }>;
}

export interface BranchState {
  /** All branches in the current conversation */
  branches: ConversationBranch[];
  /** The currently active branch id (null = main thread) */
  activeBranchId: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max branches per conversation */
const MAX_BRANCHES = 10;

/** Main branch sentinel id */
export const MAIN_BRANCH_ID = '__main__';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const generateBranchId = (): string =>
  `branch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Create the initial branch state (no branches yet) */
export const createInitialBranchState = (): BranchState => ({
  branches: [],
  activeBranchId: null,
});

/**
 * Create a new branch from a specific message index in the main conversation.
 * Returns the updated branch state and the new branch id.
 */
export const createBranch = (
  state: BranchState,
  forkPointIndex: number,
  mainMessages: BranchMessage[],
  label?: string,
): { state: BranchState; branchId: string } => {
  if (state.branches.length >= MAX_BRANCHES) {
    // Remove the oldest branch to make room
    const sorted = [...state.branches].sort((a, b) => a.createdAt - b.createdAt);
    state = {
      ...state,
      branches: state.branches.filter((b) => b.id !== sorted[0].id),
    };
  }

  const branchId = generateBranchId();
  const autoLabel =
    label || deriveBranchLabel(mainMessages, forkPointIndex, state.branches.length + 1);

  const branch: ConversationBranch = {
    id: branchId,
    label: autoLabel,
    forkPointIndex,
    parentBranchId: state.activeBranchId,
    messages: [],
    createdAt: Date.now(),
  };

  return {
    state: {
      branches: [...state.branches, branch],
      activeBranchId: branchId,
    },
    branchId,
  };
};

/**
 * Delete a branch by id.
 * If the deleted branch is active, switch back to main.
 */
export const deleteBranch = (state: BranchState, branchId: string): BranchState => {
  const branches = state.branches.filter((b) => b.id !== branchId);
  const activeBranchId = state.activeBranchId === branchId ? null : state.activeBranchId;
  return { branches, activeBranchId };
};

/**
 * Switch to a different branch (or back to main with null).
 */
export const switchBranch = (state: BranchState, branchId: string | null): BranchState => ({
  ...state,
  activeBranchId: branchId,
});

/**
 * Add a message to the currently active branch.
 */
export const addMessageToBranch = (
  state: BranchState,
  branchId: string,
  message: BranchMessage,
): BranchState => {
  const branches = state.branches.map((b) =>
    b.id === branchId ? { ...b, messages: [...b.messages, message] } : b,
  );
  return { ...state, branches };
};

/**
 * Update messages on a branch (e.g., when the full message array changes).
 */
export const updateBranchMessages = (
  state: BranchState,
  branchId: string,
  messages: BranchMessage[],
): BranchState => {
  const branches = state.branches.map((b) => (b.id === branchId ? { ...b, messages } : b));
  return { ...state, branches };
};

/**
 * Get the full message list for a branch:
 * main messages up to forkPointIndex + branch-specific messages.
 */
export const getBranchMessages = (
  mainMessages: BranchMessage[],
  branch: ConversationBranch,
): BranchMessage[] => {
  const base = mainMessages.slice(0, branch.forkPointIndex + 1);
  return [...base, ...branch.messages];
};

/**
 * Get the active branch object, or null if on main.
 */
export const getActiveBranch = (state: BranchState): ConversationBranch | null => {
  if (!state.activeBranchId) return null;
  return state.branches.find((b) => b.id === state.activeBranchId) ?? null;
};

/**
 * Rename a branch.
 */
export const renameBranch = (
  state: BranchState,
  branchId: string,
  newLabel: string,
): BranchState => {
  const branches = state.branches.map((b) => (b.id === branchId ? { ...b, label: newLabel } : b));
  return { ...state, branches };
};

/**
 * Check if any branches exist.
 */
export const hasBranches = (state: BranchState): boolean => state.branches.length > 0;

/**
 * Get the count of branches forking from a specific message index.
 */
export const getBranchCountAtIndex = (state: BranchState, messageIndex: number): number =>
  state.branches.filter((b) => b.forkPointIndex === messageIndex).length;

/**
 * Get branches that fork from a specific message index.
 */
export const getBranchesAtIndex = (
  state: BranchState,
  messageIndex: number,
): ConversationBranch[] => state.branches.filter((b) => b.forkPointIndex === messageIndex);

// ---------------------------------------------------------------------------
// Label derivation
// ---------------------------------------------------------------------------

/**
 * Auto-generate a branch label from the fork point context.
 */
const deriveBranchLabel = (
  messages: BranchMessage[],
  forkIndex: number,
  branchNumber: number,
): string => {
  const forkMsg = messages[forkIndex];
  if (!forkMsg) return `Branch ${branchNumber}`;

  // Use first few words of the fork message for context
  const words = forkMsg.content.trim().split(/\s+/).slice(0, 4).join(' ');
  const truncated = words.length > 25 ? `${words.slice(0, 22)}...` : words;

  return truncated || `Branch ${branchNumber}`;
};
