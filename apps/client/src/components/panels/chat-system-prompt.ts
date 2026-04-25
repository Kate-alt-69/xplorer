/**
 * System prompt builder for the AI chat agent.
 * Assembles context from workspace awareness, agent memory, feedback,
 * extensions, security rules, file contexts, and editor selection
 * into a single system prompt string.
 *
 * Performance: heavy context sections (workspace, memory, feedback,
 * security rules) are cached with TTLs to avoid redundant localStorage
 * reads and recomputation on every message.
 *
 * Extracted from StandaloneChatPanel to keep it under the 1000-line limit.
 */
import { FILE_OPS_SYSTEM_PROMPT } from './chat-file-actions';
import { type XplorerState, type FileContext, buildDirectoryContext } from './chat-context-helpers';
import { type WorkspaceContext, buildWorkspacePrompt } from './chat-workspace-awareness';
import { buildMemoryPrompt } from './chat-agent-memory';
import { buildFeedbackPrompt } from './chat-correction-learning';
import { loadFeedbackEntries, getFolderFeedback } from './chat-feedback-store';
import {
  buildExtensionAwarenessPrompt,
  getContextualExtensionSuggestions,
} from './chat-extension-awareness';
import { loadSecurityRules, type SecurityRules } from './chat-security-rules';
import { SMART_FILE_OPS_PROMPT } from './chat-smart-file-ops';
import { AI_SEARCH_PROMPT } from './chat-search-integration';
import {
  DOCUMENT_INTELLIGENCE_PROMPT,
  checkSummarizationSuggestion,
} from './chat-document-intelligence';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SystemPromptOptions {
  xState: XplorerState | undefined;
  fileContexts: FileContext[];
  workspaceCtx: WorkspaceContext | null;
  includeSelection: boolean;
  agentLoopContext?: string;
}

// ---------------------------------------------------------------------------
// Prompt section cache — avoids redundant localStorage reads and recomputation
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  /** Optional secondary key (e.g. folder path) to invalidate on navigation */
  key?: string;
}

/** Cache TTLs */
const WORKSPACE_CACHE_TTL_MS = 30_000; // 30 seconds
const MEMORY_CACHE_TTL_MS = 30_000; // 30 seconds
const FEEDBACK_CACHE_TTL_MS = 30_000; // 30 seconds
const SECURITY_CACHE_TTL_MS = 30_000; // 30 seconds

let _workspacePromptCache: CacheEntry<string> | null = null;
let _memoryPromptCache: CacheEntry<string> | null = null;
let _feedbackPromptCache: CacheEntry<string> | null = null;
let _securityRulesCache: CacheEntry<SecurityRules> | null = null;

const isCacheValid = <T>(
  cache: CacheEntry<T> | null,
  ttl: number,
  key?: string,
): cache is CacheEntry<T> => {
  if (!cache) return false;
  if (Date.now() - cache.timestamp > ttl) return false;
  if (key !== undefined && cache.key !== key) return false;
  return true;
};

/**
 * Invalidate all prompt caches. Call when the user changes settings
 * or navigates to a new folder to force a fresh build.
 */
export const invalidatePromptCaches = (): void => {
  _workspacePromptCache = null;
  _memoryPromptCache = null;
  _feedbackPromptCache = null;
  _securityRulesCache = null;
};

// ---------------------------------------------------------------------------
// Cached accessors
// ---------------------------------------------------------------------------

const getCachedWorkspacePrompt = (ctx: WorkspaceContext | null): string => {
  if (!ctx) return '';
  // Use a stable cache key derived from the context
  const cacheKey = `${ctx.fileCount}:${ctx.dirCount}:${ctx.git.branch ?? ''}`;
  if (isCacheValid(_workspacePromptCache, WORKSPACE_CACHE_TTL_MS, cacheKey)) {
    return _workspacePromptCache.value;
  }
  const result = buildWorkspacePrompt(ctx);
  _workspacePromptCache = { value: result, timestamp: Date.now(), key: cacheKey };
  return result;
};

const getCachedMemoryPrompt = (folderPath: string): string => {
  if (isCacheValid(_memoryPromptCache, MEMORY_CACHE_TTL_MS, folderPath)) {
    return _memoryPromptCache.value;
  }
  const result = buildMemoryPrompt(folderPath);
  _memoryPromptCache = { value: result, timestamp: Date.now(), key: folderPath };
  return result;
};

const getCachedFeedbackPrompt = (folderPath: string | undefined): string => {
  const cacheKey = folderPath ?? '__global__';
  if (isCacheValid(_feedbackPromptCache, FEEDBACK_CACHE_TTL_MS, cacheKey)) {
    return _feedbackPromptCache.value;
  }
  const folderFb = folderPath ? getFolderFeedback(folderPath) : [];
  const allFb = loadFeedbackEntries();
  const feedbackToUse = folderFb.length > 0 ? folderFb : allFb;
  const result = buildFeedbackPrompt(feedbackToUse);
  _feedbackPromptCache = { value: result, timestamp: Date.now(), key: cacheKey };
  return result;
};

const getCachedSecurityRules = (): SecurityRules => {
  if (isCacheValid(_securityRulesCache, SECURITY_CACHE_TTL_MS)) {
    return _securityRulesCache.value;
  }
  const result = loadSecurityRules();
  _securityRulesCache = { value: result, timestamp: Date.now() };
  return result;
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the full system prompt for the AI agent, incorporating all available context.
 */
export const buildSystemPrompt = async (opts: SystemPromptOptions): Promise<string> => {
  const { xState, fileContexts, workspaceCtx, includeSelection, agentLoopContext } = opts;

  let systemContent =
    "You are an AI agent inside the Xplorer file manager. You can observe the user's filesystem, understand their context, and take actions to help them manage files.\n\n" +
    'BEHAVIOR RULES — read carefully:\n' +
    "1. ACT, don't ASK. When the user asks you to do something, JUST DO IT. Don't say 'Would you like me to...' or 'Should I...' — read the file, run the command, make the change. The user will be prompted to approve any action that needs permission, so you don't need to ask first.\n" +
    "2. BE CONCISE. Don't write 'Step 1, Step 2' explanations. Don't restate what you're about to do. Just do it and report results in 1-3 sentences.\n" +
    "3. DON'T LECTURE. Skip 'best practices', 'recommendations', and 'workflow' explanations unless the user explicitly asks for analysis. They want results, not a tutorial.\n" +
    "4. USE TOOLS, DON'T DESCRIBE THEM. Instead of 'I'll run pnpm outdated to check...', emit the run_command action immediately and show the output.\n" +
    '5. CHAIN ACTIONS. If the task needs multiple steps (read file → analyze → run command), do them all in one turn without checking in between. The agent loop will iterate.\n' +
    "6. ANSWER WITH RESULTS. After actions complete, give the user the actual answer (e.g., 'Found 3 outdated: react 18.2→18.3, ...'), not a process narration.";
  systemContent += `\n\n${FILE_OPS_SYSTEM_PROMPT}`;
  systemContent += `\n\n${SMART_FILE_OPS_PROMPT}`;
  systemContent += `\n\n${AI_SEARCH_PROMPT}`;
  systemContent += `\n\n${DOCUMENT_INTELLIGENCE_PROMPT}`;

  // Inject workspace awareness (project type, git info, directory overview) — cached 30s
  {
    const workspacePrompt = getCachedWorkspacePrompt(workspaceCtx);
    if (workspacePrompt) {
      systemContent += `\n\n${workspacePrompt}`;
    }
  }

  // Inject agent memory (per-folder observations + global preferences) — cached 30s
  if (xState?.currentPath) {
    const memoryPrompt = getCachedMemoryPrompt(xState.currentPath);
    if (memoryPrompt) {
      systemContent += `\n${memoryPrompt}`;
    }
  }

  // Inject feedback history so the agent can learn from past mistakes — cached 30s
  {
    const feedbackPrompt = getCachedFeedbackPrompt(xState?.currentPath);
    if (feedbackPrompt) {
      systemContent += `\n${feedbackPrompt}`;
    }
  }

  // Inject installed extension awareness — cached 60s (in chat-extension-awareness.ts)
  {
    const extensionPrompt = buildExtensionAwarenessPrompt();
    if (extensionPrompt) {
      systemContent += `\n\n${extensionPrompt}`;
    }
  }

  // Inject security rules awareness so the AI avoids blocked paths — cached 30s
  {
    const secRules = getCachedSecurityRules();
    if (secRules.enabled) {
      const blockedStr = secRules.blockedPaths.slice(0, 10).join(', ');
      const protectedStr = secRules.protectedExtensions.map((e) => `.${e}`).join(', ');
      systemContent += `\n\n## Security Rules (enforced)\nBlocked paths: ${blockedStr}\nProtected file types (cannot delete): ${protectedStr}\nRate limit: ${secRules.maxOpsPerMinute} mutating ops/min.\nDo NOT attempt actions on blocked paths — they will be rejected.`;
    }
  }

  if (xState?.currentPath) {
    systemContent += `\n\n## Current Context\n[Current directory: ${xState.currentPath}]`;
    const dirListing = await buildDirectoryContext(xState.currentPath);
    systemContent += `\n\n${dirListing}`;
  }

  const selectedFileList = xState?.selectedFiles ?? [];
  if (selectedFileList.length > 0) {
    const fileList = selectedFileList
      .map((f) => `  - ${f.name} (${f.path})${f.is_dir ? ' [directory]' : ''}`)
      .join('\n');
    systemContent += `\n\n[Currently selected files]\n${fileList}`;

    // Add contextual extension suggestions for selected files
    const extSuggestions = getContextualExtensionSuggestions(
      selectedFileList,
      xState?.currentPath ?? '',
    );
    if (extSuggestions.length > 0) {
      systemContent += '\n\n[Extension suggestions for selected files]';
      for (const s of extSuggestions) {
        systemContent += `\n- ${s.message} (extension: ${s.extensionId})`;
      }
      systemContent +=
        "\nIf relevant to the user's request, suggest opening files with these extensions using the open_extension action.";
    }
  }

  // Count images vs text files in context
  const imageFiles = fileContexts.filter((fc) => fc.imageBase64);
  const textFiles = fileContexts.filter((fc) => !fc.imageBase64 && fc.content);

  if (imageFiles.length > 0) {
    systemContent += `\n\n[Image${imageFiles.length > 1 ? 's' : ''} loaded] ${imageFiles.map((f) => f.name).join(', ')} — image data is included in the user message for vision analysis. Describe what you see in detail when asked.`;
  }

  if (textFiles.length === 1 && textFiles[0].content) {
    systemContent +=
      '\n\n[File content loaded] The user has a file selected and its contents are available below.';
    systemContent += `\n\nFile: ${textFiles[0].name} (${textFiles[0].file_type})\n\`\`\`\n${textFiles[0].content}\n\`\`\``;
  } else if (textFiles.length > 1) {
    systemContent += `\n\n[Multiple file contents loaded] ${textFiles.length} files in context.`;
    for (const fc of textFiles) {
      if (fc.content) {
        systemContent += `\n\n### ${fc.name} (${fc.file_type})\n\`\`\`\n${fc.content}\n\`\`\``;
      }
    }
  }

  // For non-image files with image context but no base64 (too large), add metadata
  const imageMetadataOnly = fileContexts.filter(
    (fc) => !fc.imageBase64 && fc.content?.startsWith('[Image file:'),
  );
  if (imageMetadataOnly.length > 0) {
    for (const fc of imageMetadataOnly) {
      systemContent += `\n\n${fc.content}`;
    }
  }

  // Add summarization suggestions for large documents in context
  {
    const summarySuggestions: string[] = [];
    const selectedFiles = xState?.selectedFiles ?? [];
    for (const file of selectedFiles) {
      if (file.is_dir) continue;
      // Estimate size from file context content length (rough proxy)
      const fc = fileContexts.find((c) => c.path === file.path);
      const estimatedSize = fc?.content?.length ?? 0;
      const suggestion = checkSummarizationSuggestion({
        name: file.name,
        path: file.path,
        size: estimatedSize,
      });
      if (suggestion) {
        summarySuggestions.push(suggestion);
      }
    }
    if (summarySuggestions.length > 0) {
      systemContent += `\n\n[Document intelligence suggestion]\n${summarySuggestions.join('\n')}`;
    }
  }

  if (includeSelection && xState?.editorSelection) {
    const sel = xState.editorSelection;
    systemContent += `\n\n[Selected code in ${sel.filePath} lines ${sel.startLine}-${sel.endLine}]\n\`\`\`\n${sel.text}\n\`\`\``;
  }

  if (agentLoopContext) {
    systemContent += `\n\n## Results from your previous actions\n${agentLoopContext}`;
    systemContent +=
      '\n\nUse these results to continue with the task. If you have all the information you need, proceed with the final actions. Do not repeat actions you already performed.';
  }

  return systemContent;
};

// ---------------------------------------------------------------------------
// Markdown export helper
// ---------------------------------------------------------------------------

/**
 * Export chat messages as a markdown file download.
 */
export const exportChatAsMarkdown = (
  messages: Array<{ role: string; content: string; isContextInjection?: boolean }>,
): void => {
  if (messages.length === 0) return;
  const lines: string[] = ['# Chat Export\n'];
  for (const msg of messages) {
    if (msg.isContextInjection) continue;
    const role = msg.role === 'user' ? 'You' : 'AI';
    lines.push(`## ${role}\n`);
    lines.push(msg.content);
    lines.push('');
  }
  const markdown = lines.join('\n');
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chat-export-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
