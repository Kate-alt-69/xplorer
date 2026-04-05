import { describe, it, expect } from 'vitest';
import {
  createInitialBranchState,
  createBranch,
  deleteBranch,
  switchBranch,
  addMessageToBranch,
  getBranchMessages,
  getActiveBranch,
  renameBranch,
  hasBranches,
  getBranchCountAtIndex,
  getBranchesAtIndex,
  type BranchMessage,
  type BranchState,
} from '@/components/panels/chat-branching';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeMessages = (count: number): BranchMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${i}`,
  }));

// ---------------------------------------------------------------------------
// createInitialBranchState
// ---------------------------------------------------------------------------

describe('createInitialBranchState', () => {
  it('creates an empty branch state', () => {
    const state = createInitialBranchState();
    expect(state.branches).toEqual([]);
    expect(state.activeBranchId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createBranch
// ---------------------------------------------------------------------------

describe('createBranch', () => {
  it('creates a new branch from a fork point', () => {
    const initial = createInitialBranchState();
    const msgs = makeMessages(6);
    const { state, branchId } = createBranch(initial, 3, msgs);

    expect(state.branches).toHaveLength(1);
    expect(state.activeBranchId).toBe(branchId);
    expect(state.branches[0].forkPointIndex).toBe(3);
    expect(state.branches[0].messages).toEqual([]);
  });

  it('auto-generates a label from fork message context', () => {
    const msgs = makeMessages(6);
    const { state } = createBranch(createInitialBranchState(), 2, msgs);
    expect(state.branches[0].label).toBeTruthy();
    expect(state.branches[0].label.length).toBeGreaterThan(0);
  });

  it('uses custom label when provided', () => {
    const msgs = makeMessages(4);
    const { state } = createBranch(createInitialBranchState(), 1, msgs, 'My Branch');
    expect(state.branches[0].label).toBe('My Branch');
  });

  it('evicts oldest branch when MAX_BRANCHES is reached', () => {
    let state: BranchState = createInitialBranchState();
    const msgs = makeMessages(4);

    // Create 10 branches (max)
    for (let i = 0; i < 10; i++) {
      const result = createBranch(state, 1, msgs, `Branch ${i}`);
      state = result.state;
    }
    expect(state.branches).toHaveLength(10);

    // Creating an 11th should evict the oldest
    const result = createBranch(state, 1, msgs, 'Branch 10');
    expect(result.state.branches).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// deleteBranch
// ---------------------------------------------------------------------------

describe('deleteBranch', () => {
  it('removes a branch by id', () => {
    const msgs = makeMessages(4);
    const { state, branchId } = createBranch(createInitialBranchState(), 1, msgs);
    const deleted = deleteBranch(state, branchId);

    expect(deleted.branches).toHaveLength(0);
  });

  it('switches to main when active branch is deleted', () => {
    const msgs = makeMessages(4);
    const { state, branchId } = createBranch(createInitialBranchState(), 1, msgs);
    expect(state.activeBranchId).toBe(branchId);

    const deleted = deleteBranch(state, branchId);
    expect(deleted.activeBranchId).toBeNull();
  });

  it('does not change active branch when deleting an inactive branch', () => {
    const msgs = makeMessages(4);
    let state = createInitialBranchState();
    const result1 = createBranch(state, 1, msgs, 'A');
    state = result1.state;
    const result2 = createBranch(state, 2, msgs, 'B');
    state = result2.state;

    // Active is branch B, delete branch A
    const deleted = deleteBranch(state, result1.branchId);
    expect(deleted.activeBranchId).toBe(result2.branchId);
    expect(deleted.branches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// switchBranch
// ---------------------------------------------------------------------------

describe('switchBranch', () => {
  it('switches to a specific branch', () => {
    const msgs = makeMessages(4);
    const { state: created, branchId } = createBranch(createInitialBranchState(), 1, msgs);
    const main = switchBranch(created, null);
    expect(main.activeBranchId).toBeNull();

    const switched = switchBranch(main, branchId);
    expect(switched.activeBranchId).toBe(branchId);
  });
});

// ---------------------------------------------------------------------------
// getBranchMessages
// ---------------------------------------------------------------------------

describe('getBranchMessages', () => {
  it('returns main messages up to fork point + branch messages', () => {
    const mainMsgs = makeMessages(6);
    const { state, branchId } = createBranch(createInitialBranchState(), 3, mainMsgs);

    // Add a message to the branch
    const updatedState = addMessageToBranch(state, branchId, {
      role: 'user',
      content: 'Branch message',
    });
    const updatedBranch = updatedState.branches.find((b) => b.id === branchId)!;

    const allMsgs = getBranchMessages(mainMsgs, updatedBranch);
    // 4 main messages (indices 0-3) + 1 branch message
    expect(allMsgs).toHaveLength(5);
    expect(allMsgs[4].content).toBe('Branch message');
  });
});

// ---------------------------------------------------------------------------
// getActiveBranch
// ---------------------------------------------------------------------------

describe('getActiveBranch', () => {
  it('returns null when on main branch', () => {
    const state = createInitialBranchState();
    expect(getActiveBranch(state)).toBeNull();
  });

  it('returns the active branch object', () => {
    const msgs = makeMessages(4);
    const { state, branchId } = createBranch(createInitialBranchState(), 1, msgs, 'Test');
    const active = getActiveBranch(state);
    expect(active).not.toBeNull();
    expect(active!.id).toBe(branchId);
    expect(active!.label).toBe('Test');
  });
});

// ---------------------------------------------------------------------------
// renameBranch
// ---------------------------------------------------------------------------

describe('renameBranch', () => {
  it('renames a branch', () => {
    const msgs = makeMessages(4);
    const { state, branchId } = createBranch(createInitialBranchState(), 1, msgs, 'Old Name');
    const renamed = renameBranch(state, branchId, 'New Name');
    const branch = renamed.branches.find((b) => b.id === branchId)!;
    expect(branch.label).toBe('New Name');
  });
});

// ---------------------------------------------------------------------------
// hasBranches
// ---------------------------------------------------------------------------

describe('hasBranches', () => {
  it('returns false for initial state', () => {
    expect(hasBranches(createInitialBranchState())).toBe(false);
  });

  it('returns true after creating a branch', () => {
    const msgs = makeMessages(4);
    const { state } = createBranch(createInitialBranchState(), 1, msgs);
    expect(hasBranches(state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getBranchCountAtIndex / getBranchesAtIndex
// ---------------------------------------------------------------------------

describe('getBranchCountAtIndex', () => {
  it('returns 0 when no branches fork from that index', () => {
    const state = createInitialBranchState();
    expect(getBranchCountAtIndex(state, 5)).toBe(0);
  });

  it('counts branches forking from a specific index', () => {
    const msgs = makeMessages(6);
    let state = createInitialBranchState();
    state = createBranch(state, 3, msgs, 'A').state;
    // Switch back to main before creating another branch
    state = switchBranch(state, null);
    state = createBranch(state, 3, msgs, 'B').state;

    expect(getBranchCountAtIndex(state, 3)).toBe(2);
    expect(getBranchCountAtIndex(state, 1)).toBe(0);
  });
});

describe('getBranchesAtIndex', () => {
  it('returns branches forking from a specific index', () => {
    const msgs = makeMessages(6);
    let state = createInitialBranchState();
    state = createBranch(state, 2, msgs, 'Branch A').state;
    state = switchBranch(state, null);
    state = createBranch(state, 2, msgs, 'Branch B').state;

    const branches = getBranchesAtIndex(state, 2);
    expect(branches).toHaveLength(2);
  });
});
