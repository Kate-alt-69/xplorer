/**
 * System prompt builder for the AI chat agent.
 * Assembles context from workspace awareness, agent memory, feedback,
 * extensions, security rules, file contexts, and editor selection
 * into a single system prompt string.
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
import { loadSecurityRules } from './chat-security-rules';

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
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the full system prompt for the AI agent, incorporating all available context.
 */
export const buildSystemPrompt = async (opts: SystemPromptOptions): Promise<string> => {
  const { xState, fileContexts, workspaceCtx, includeSelection, agentLoopContext } = opts;

  let systemContent =
    "You are an AI agent inside the Xplorer file manager. You can observe the user's filesystem, understand their context, and take actions to help them manage files.";
  systemContent += `\n\n${FILE_OPS_SYSTEM_PROMPT}`;

  // Inject workspace awareness (project type, git info, directory overview)
  if (workspaceCtx) {
    const workspacePrompt = buildWorkspacePrompt(workspaceCtx);
    if (workspacePrompt) {
      systemContent += `\n\n${workspacePrompt}`;
    }
  }

  // Inject agent memory (per-folder observations + global preferences)
  if (xState?.currentPath) {
    const memoryPrompt = buildMemoryPrompt(xState.currentPath);
    if (memoryPrompt) {
      systemContent += `\n${memoryPrompt}`;
    }
  }

  // Inject feedback history so the agent can learn from past mistakes
  {
    const folderFb = xState?.currentPath ? getFolderFeedback(xState.currentPath) : [];
    const allFb = loadFeedbackEntries();
    const feedbackToUse = folderFb.length > 0 ? folderFb : allFb;
    const feedbackPrompt = buildFeedbackPrompt(feedbackToUse);
    if (feedbackPrompt) {
      systemContent += `\n${feedbackPrompt}`;
    }
  }

  // Inject installed extension awareness
  {
    const extensionPrompt = buildExtensionAwarenessPrompt();
    if (extensionPrompt) {
      systemContent += `\n\n${extensionPrompt}`;
    }
  }

  // Inject security rules awareness so the AI avoids blocked paths
  {
    const secRules = loadSecurityRules();
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
