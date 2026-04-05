/**
 * Hook for conversation branching state management.
 * Handles creating, switching, deleting, and renaming branches.
 */
import { useState, useCallback } from 'react';
import {
  type BranchState,
  type BranchMessage,
  createInitialBranchState,
  createBranch,
  deleteBranch as deleteBranchFn,
  switchBranch as switchBranchFn,
  getActiveBranch,
  getBranchMessages,
  updateBranchMessages,
  getBranchCountAtIndex,
  hasBranches,
  renameBranch as renameBranchFn,
} from './chat-branching';
import { type RuntimeChatMessage } from './ChatMessageBubble';
import { type SavedConversation } from './chat-history';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseChatBranchingOptions {
  messages: RuntimeChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<RuntimeChatMessage[]>>;
  chatHistory: SavedConversation[];
  currentConversationId: string | null;
  scrollToBottom: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useChatBranching = ({
  messages,
  setMessages,
  chatHistory,
  currentConversationId,
  scrollToBottom,
}: UseChatBranchingOptions) => {
  const [branchState, setBranchState] = useState<BranchState>(createInitialBranchState());

  const resetBranches = useCallback(() => {
    setBranchState(createInitialBranchState());
  }, []);

  const handleCreateBranch = useCallback(
    (forkIndex: number) => {
      const mainMsgs: BranchMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
        isContextInjection: m.isContextInjection,
        droppedFiles: m.droppedFiles,
      }));
      const { state: newState } = createBranch(branchState, forkIndex, mainMsgs);
      setBranchState(newState);
      const activeBranch = newState.branches.find((b) => b.id === newState.activeBranchId);
      if (activeBranch) {
        const branchMsgs = getBranchMessages(mainMsgs, activeBranch) as RuntimeChatMessage[];
        setMessages(branchMsgs);
      }
      scrollToBottom();
    },
    [messages, branchState, scrollToBottom, setMessages],
  );

  const handleSwitchBranch = useCallback(
    (branchId: string | null) => {
      const activeBranch = getActiveBranch(branchState);
      let updatedState = branchState;
      if (activeBranch) {
        const branchOnlyMsgs: BranchMessage[] = messages
          .slice(activeBranch.forkPointIndex + 1)
          .map((m) => ({
            role: m.role,
            content: m.content,
            isContextInjection: m.isContextInjection,
            droppedFiles: m.droppedFiles,
          }));
        updatedState = updateBranchMessages(branchState, activeBranch.id, branchOnlyMsgs);
      }

      const newState = switchBranchFn(updatedState, branchId);
      setBranchState(newState);

      if (branchId === null) {
        const conv = chatHistory.find((c) => c.id === currentConversationId);
        if (conv) {
          setMessages(conv.messages as RuntimeChatMessage[]);
        }
      } else {
        const targetBranch = newState.branches.find((b) => b.id === branchId);
        if (targetBranch) {
          const conv = chatHistory.find((c) => c.id === currentConversationId);
          const mainMsgs = (conv?.messages ??
            messages.slice(0, targetBranch.forkPointIndex + 1)) as RuntimeChatMessage[];
          const branchMsgs = getBranchMessages(
            mainMsgs.map((m) => ({
              role: m.role,
              content: m.content,
              isContextInjection: m.isContextInjection,
              droppedFiles: m.droppedFiles,
            })),
            targetBranch,
          ) as RuntimeChatMessage[];
          setMessages(branchMsgs);
        }
      }
      scrollToBottom();
    },
    [branchState, messages, chatHistory, currentConversationId, scrollToBottom, setMessages],
  );

  const handleDeleteBranch = useCallback(
    (branchId: string) => {
      const newState = deleteBranchFn(branchState, branchId);
      setBranchState(newState);
      if (branchState.activeBranchId === branchId) {
        const conv = chatHistory.find((c) => c.id === currentConversationId);
        if (conv) {
          setMessages(conv.messages as RuntimeChatMessage[]);
        }
      }
    },
    [branchState, chatHistory, currentConversationId, setMessages],
  );

  const handleRenameBranch = useCallback((branchId: string, newLabel: string) => {
    setBranchState((prev) => renameBranchFn(prev, branchId, newLabel));
  }, []);

  const getMessageBranchCount = useCallback(
    (messageIndex: number): number => {
      if (branchState.activeBranchId !== null) return 0;
      return getBranchCountAtIndex(branchState, messageIndex);
    },
    [branchState],
  );

  return {
    branchState,
    resetBranches,
    handleCreateBranch,
    handleSwitchBranch,
    handleDeleteBranch,
    handleRenameBranch,
    getMessageBranchCount,
    hasBranches: hasBranches(branchState),
    isOnMainBranch: branchState.activeBranchId === null,
  };
};
