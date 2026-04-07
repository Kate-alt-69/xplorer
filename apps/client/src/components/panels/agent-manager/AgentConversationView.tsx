/**
 * Agent Conversation View — dedicated message view for a single agent session.
 *
 * Renders the conversation thread with markdown content, inline tool-call
 * indicators, pending approval cards, and an input field to send new messages.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Send,
  FileText,
  FileEdit,
  Terminal,
  FilePlus2,
  Trash2,
  Search,
  FolderOpen,
  Loader2,
  CheckCircle2,
  XCircle,
  Bot,
  User,
} from 'lucide-react';
import MarkdownRenderer from '@/components/ui/MarkdownRenderer';
import type { AgentSessionSummary } from '@/lib/tauri-api-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolCallKind =
  | 'read_file'
  | 'edit_file'
  | 'create_file'
  | 'delete_file'
  | 'run_command'
  | 'search_files'
  | 'list_directory';

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error';

export interface AgentToolCall {
  id: string;
  kind: ToolCallKind;
  /** Primary argument (file path or command string) */
  target: string;
  status: ToolCallStatus;
  /** Short result summary (e.g. "42 lines read") */
  resultSummary?: string;
  error?: string;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** Tool calls embedded in this assistant message */
  toolCalls?: AgentToolCall[];
  /** Whether the message is still being streamed */
  streaming?: boolean;
}

export interface PendingApproval {
  id: string;
  /** What the agent wants to do */
  description: string;
  /** File path or command */
  target: string;
  kind: 'file' | 'command';
  status: 'pending' | 'approved' | 'rejected';
}

interface AgentConversationViewProps {
  /** The agent session being viewed */
  session: AgentSessionSummary;
  /** Conversation messages */
  messages: AgentMessage[];
  /** Pending approvals waiting for user action */
  pendingApprovals?: PendingApproval[];
  /** Called when the user sends a new message */
  onSendMessage: (sessionId: string, message: string) => void;
  /** Called when the user clicks the back button */
  onBack: () => void;
  /** Called when user approves a pending action */
  onApprove?: (approvalId: string) => void;
  /** Called when user rejects a pending action */
  onReject?: (approvalId: string) => void;
}

// ---------------------------------------------------------------------------
// Tool-call icon + label mapping
// ---------------------------------------------------------------------------

const TOOL_CALL_CONFIG: Record<ToolCallKind, { Icon: typeof FileText; labelKey: string }> = {
  read_file: { Icon: FileText, labelKey: 'agentManager.conversation.toolCall.readFile' },
  edit_file: { Icon: FileEdit, labelKey: 'agentManager.conversation.toolCall.editFile' },
  create_file: { Icon: FilePlus2, labelKey: 'agentManager.conversation.toolCall.createFile' },
  delete_file: { Icon: Trash2, labelKey: 'agentManager.conversation.toolCall.deleteFile' },
  run_command: { Icon: Terminal, labelKey: 'agentManager.conversation.toolCall.runCommand' },
  search_files: { Icon: Search, labelKey: 'agentManager.conversation.toolCall.searchFiles' },
  list_directory: {
    Icon: FolderOpen,
    labelKey: 'agentManager.conversation.toolCall.listDirectory',
  },
};

const STATUS_ICON_MAP: Record<ToolCallStatus, typeof Loader2> = {
  pending: Loader2,
  running: Loader2,
  success: CheckCircle2,
  error: XCircle,
};

const STATUS_COLOR_MAP: Record<ToolCallStatus, string> = {
  pending: 'var(--xp-text-muted)',
  running: 'var(--xp-blue, #7aa2f7)',
  success: 'var(--xp-green, #73daca)',
  error: 'var(--xp-red, #f7768e)',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const ToolCallInline = ({ call }: { call: AgentToolCall }) => {
  const { t } = useTranslation();
  const config = TOOL_CALL_CONFIG[call.kind];
  const { Icon } = config;
  const StatusIcon = STATUS_ICON_MAP[call.status];
  const statusColor = STATUS_COLOR_MAP[call.status];
  const isAnimated = call.status === 'pending' || call.status === 'running';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 8px',
        margin: '4px 0',
        borderRadius: '4px',
        background: 'var(--xp-surface)',
        border: '1px solid var(--xp-border)',
        fontSize: '11px',
        color: 'var(--xp-text-muted)',
      }}
    >
      <Icon size={12} style={{ flexShrink: 0, color: statusColor }} />
      <span style={{ fontWeight: 500 }}>{t(config.labelKey)}:</span>
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: 'monospace',
          fontSize: '10px',
        }}
        title={call.target}
      >
        {call.target}
      </span>
      {call.resultSummary && (
        <span style={{ fontSize: '9px', color: 'var(--xp-text-muted)', flexShrink: 0 }}>
          {call.resultSummary}
        </span>
      )}
      <StatusIcon
        size={11}
        style={{
          flexShrink: 0,
          color: statusColor,
          animation: isAnimated ? 'spin 1s linear infinite' : undefined,
        }}
      />
    </div>
  );
};

const ApprovalCard = ({
  approval,
  onApprove,
  onReject,
}: {
  approval: PendingApproval;
  onApprove?: () => void;
  onReject?: () => void;
}) => {
  const { t } = useTranslation();
  const isPending = approval.status === 'pending';

  return (
    <div
      style={{
        border: '1px solid var(--xp-warning, #e0af68)',
        borderRadius: '6px',
        padding: '8px 10px',
        margin: '6px 0',
        background: 'rgba(224, 175, 104, 0.08)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '11px',
          color: 'var(--xp-text)',
        }}
      >
        {approval.kind === 'command' ? (
          <Terminal size={12} style={{ color: 'var(--xp-warning, #e0af68)', flexShrink: 0 }} />
        ) : (
          <FileText size={12} style={{ color: 'var(--xp-warning, #e0af68)', flexShrink: 0 }} />
        )}
        <span style={{ fontWeight: 500 }}>{approval.description}</span>
      </div>
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: '10px',
          color: 'var(--xp-text-muted)',
          marginTop: '4px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={approval.target}
      >
        {approval.target}
      </div>
      {isPending && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
          {onApprove && (
            <button
              onClick={onApprove}
              style={{
                flex: 1,
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid var(--xp-green, #73daca)',
                background: 'rgba(115, 218, 202, 0.15)',
                color: 'var(--xp-green, #73daca)',
                cursor: 'pointer',
                fontSize: '10px',
                fontWeight: 600,
              }}
            >
              {t('agentManager.conversation.allow')}
            </button>
          )}
          {onReject && (
            <button
              onClick={onReject}
              style={{
                flex: 1,
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid var(--xp-red, #f7768e)',
                background: 'rgba(247, 118, 142, 0.15)',
                color: 'var(--xp-red, #f7768e)',
                cursor: 'pointer',
                fontSize: '10px',
                fontWeight: 600,
              }}
            >
              {t('agentManager.conversation.deny')}
            </button>
          )}
        </div>
      )}
      {approval.status === 'approved' && (
        <div style={{ fontSize: '10px', color: 'var(--xp-green, #73daca)', marginTop: '4px' }}>
          <CheckCircle2 size={10} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
          {t('agentManager.conversation.approved')}
        </div>
      )}
      {approval.status === 'rejected' && (
        <div style={{ fontSize: '10px', color: 'var(--xp-red, #f7768e)', marginTop: '4px' }}>
          <XCircle size={10} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
          {t('agentManager.conversation.rejected')}
        </div>
      )}
    </div>
  );
};

const MessageBubble = ({
  message,
  pendingApprovals,
  onApprove,
  onReject,
}: {
  message: AgentMessage;
  pendingApprovals?: PendingApproval[];
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}) => {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const RoleIcon = isUser ? User : Bot;
  const roleColor = isUser ? 'var(--xp-blue, #7aa2f7)' : 'var(--xp-green, #73daca)';

  if (isSystem) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: '8px 0',
      }}
    >
      {/* Role header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '10px',
          color: roleColor,
          fontWeight: 600,
        }}
      >
        <RoleIcon size={12} />
        <span>
          {isUser
            ? t('agentManager.conversation.roleYou')
            : t('agentManager.conversation.roleAgent')}
        </span>
        <span
          style={{
            fontSize: '9px',
            color: 'var(--xp-text-muted)',
            fontWeight: 400,
            marginLeft: 'auto',
          }}
        >
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Tool calls (before content, as they represent the agent's actions) */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div style={{ marginTop: '2px' }}>
          {message.toolCalls.map((call) => (
            <ToolCallInline key={call.id} call={call} />
          ))}
        </div>
      )}

      {/* Message content */}
      {message.content && (
        <div
          style={{
            fontSize: '12px',
            color: 'var(--xp-text)',
            lineHeight: 1.5,
            marginTop: '2px',
          }}
        >
          <MarkdownRenderer content={message.content} />
        </div>
      )}

      {/* Streaming indicator */}
      {message.streaming && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '10px',
            color: 'var(--xp-text-muted)',
          }}
        >
          <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
          <span>{t('agentManager.conversation.thinking')}</span>
        </div>
      )}

      {/* Pending approvals */}
      {pendingApprovals &&
        pendingApprovals.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            onApprove={onApprove ? () => onApprove(approval.id) : undefined}
            onReject={onReject ? () => onReject(approval.id) : undefined}
          />
        ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const AgentConversationView = ({
  session,
  messages,
  pendingApprovals = [],
  onSendMessage,
  onBack,
  onApprove,
  onReject,
}: AgentConversationViewProps) => {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    onSendMessage(session.id, trimmed);
    setInputValue('');
  }, [inputValue, onSendMessage, session.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const isActive =
    session.status === 'thinking' ||
    session.status === 'executing' ||
    session.status === 'waiting_approval' ||
    session.status === 'idle';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 10px',
          borderBottom: '1px solid var(--xp-border)',
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          title={t('agentManager.conversation.back')}
          aria-label={t('agentManager.conversation.back')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--xp-text-muted)',
            padding: '2px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <ArrowLeft size={14} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--xp-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {session.name}
          </div>
          <div
            style={{
              fontSize: '10px',
              color: 'var(--xp-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {session.model} &middot; {session.working_directory}
          </div>
        </div>
        {isActive && (
          <Loader2
            size={12}
            style={{
              color: 'var(--xp-green, #73daca)',
              animation: 'spin 1s linear infinite',
              flexShrink: 0,
            }}
          />
        )}
      </div>

      {/* Message thread */}
      <div
        style={{
          flex: '1 1 0%',
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '8px 10px',
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--xp-text-muted)',
              fontSize: '11px',
              padding: '24px 12px',
            }}
          >
            {t('agentManager.conversation.noMessages')}
          </div>
        ) : (
          messages.map((msg, idx) => {
            // Only attach pending approvals to the final assistant message
            const isLastAssistant =
              msg.role === 'assistant' &&
              !messages.slice(idx + 1).some((m) => m.role === 'assistant');
            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                pendingApprovals={
                  isLastAssistant && pendingApprovals.length > 0 ? pendingApprovals : undefined
                }
                onApprove={onApprove}
                onReject={onReject}
              />
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div
        style={{
          borderTop: '1px solid var(--xp-border)',
          padding: '8px 10px',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '6px',
            background: 'var(--xp-surface)',
            border: '1px solid var(--xp-border)',
            borderRadius: '6px',
            padding: '6px 8px',
          }}
        >
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('agentManager.conversation.inputPlaceholder')}
            rows={1}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--xp-text)',
              fontSize: '12px',
              fontFamily: 'inherit',
              resize: 'none',
              minHeight: '20px',
              maxHeight: '80px',
              lineHeight: 1.4,
            }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            title={t('agentManager.conversation.sendMessage')}
            aria-label={t('agentManager.conversation.sendMessage')}
            style={{
              background: inputValue.trim()
                ? 'var(--xp-blue, #7aa2f7)'
                : 'var(--xp-surface-light, #333)',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 8px',
              cursor: inputValue.trim() ? 'pointer' : 'default',
              color: inputValue.trim() ? '#fff' : 'var(--xp-text-muted)',
              display: 'flex',
              alignItems: 'center',
              opacity: inputValue.trim() ? 1 : 0.5,
              transition: 'all 0.15s ease',
              flexShrink: 0,
            }}
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AgentConversationView;
