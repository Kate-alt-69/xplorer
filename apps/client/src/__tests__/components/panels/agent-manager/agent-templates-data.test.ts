import { describe, it, expect } from 'vitest';
import {
  AGENT_TEMPLATES,
  type AgentTemplate,
} from '@/components/panels/agent-manager/agent-templates-data';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agent-templates-data', () => {
  it('exports exactly 8 templates', () => {
    expect(AGENT_TEMPLATES).toHaveLength(8);
  });

  it('all templates have unique IDs', () => {
    const ids = AGENT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe.each(AGENT_TEMPLATES)('template "$id"', (template: AgentTemplate) => {
    it('has a non-empty id', () => {
      expect(template.id).toBeTruthy();
      expect(typeof template.id).toBe('string');
    });

    it('has a nameKey starting with agentManager.templates.', () => {
      expect(template.nameKey).toMatch(/^agentManager\.templates\./);
    });

    it('has a descriptionKey starting with agentManager.templates.', () => {
      expect(template.descriptionKey).toMatch(/^agentManager\.templates\./);
    });

    it('has a non-empty icon name', () => {
      expect(template.icon).toBeTruthy();
      expect(typeof template.icon).toBe('string');
    });

    it('has a non-empty systemPrompt', () => {
      expect(template.systemPrompt.length).toBeGreaterThan(10);
    });

    it('has a defaultModel string', () => {
      expect(template.defaultModel).toBeTruthy();
      expect(typeof template.defaultModel).toBe('string');
    });

    it('has a non-negative estimatedCostUsd', () => {
      expect(template.estimatedCostUsd).toBeGreaterThanOrEqual(0);
      expect(typeof template.estimatedCostUsd).toBe('number');
    });

    it('has an accentColor starting with var(', () => {
      expect(template.accentColor).toMatch(/^var\(/);
    });
  });

  it('includes the code-reviewer template', () => {
    expect(AGENT_TEMPLATES.find((t) => t.id === 'code-reviewer')).toBeDefined();
  });

  it('includes the test-writer template', () => {
    expect(AGENT_TEMPLATES.find((t) => t.id === 'test-writer')).toBeDefined();
  });

  it('includes the bug-fixer template', () => {
    expect(AGENT_TEMPLATES.find((t) => t.id === 'bug-fixer')).toBeDefined();
  });

  it('includes the security-auditor template', () => {
    expect(AGENT_TEMPLATES.find((t) => t.id === 'security-auditor')).toBeDefined();
  });

  it('all templates use known default models', () => {
    const knownModels = [
      'claude-sonnet-4-20250514',
      'claude-opus-4-6-20250515',
      'claude-haiku-4-5-20251001',
      'gpt-4o',
      'o3',
      'o4-mini',
      'llama3.3',
      'qwen3',
      'deepseek-r1',
    ];
    for (const t of AGENT_TEMPLATES) {
      expect(knownModels).toContain(t.defaultModel);
    }
  });
});
