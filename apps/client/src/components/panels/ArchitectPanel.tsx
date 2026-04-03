import { useState, useCallback } from 'react';
import {
  Loader2,
  Sparkles,
  RefreshCw,
  Box,
  Layers,
  GitBranch,
  FileCode,
  Server,
  Palette,
  Puzzle,
} from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import { STORAGE_KEYS } from '@/lib/storage-keys';

interface ArchitectPanelProps {
  currentPath: string;
}

interface ArchData {
  projectType: string;
  description: string;
  frontend: { framework: string; styling: string; stateManagement: string; buildTool: string };
  backend: { language: string; framework: string; database: string; runtime: string };
  patterns: string[];
  entryPoints: Array<{ file: string; purpose: string }>;
  techStack: string[];
}

let cachedAnalysis: { path: string; data: ArchData } | null = null;

const BADGE_COLORS: Record<string, string> = {
  react: '#61dafb',
  typescript: '#3178c6',
  rust: '#ce4a0a',
  tauri: '#ffc131',
  vite: '#646cff',
  tailwind: '#06b6d4',
  prisma: '#2d3748',
  postgresql: '#336791',
  nextjs: '#000',
  node: '#339933',
  python: '#3776ab',
  go: '#00add8',
  docker: '#2496ed',
  redis: '#dc382d',
  graphql: '#e10098',
  pnpm: '#f69220',
};

const getBadgeColor = (tech: string): string => {
  const key = tech.toLowerCase().replace(/[^a-z]/g, '');
  for (const [k, v] of Object.entries(BADGE_COLORS)) {
    if (key.includes(k)) return v;
  }
  return 'var(--xp-blue)';
};

const card: React.CSSProperties = {
  background: 'var(--xp-surface)',
  border: '1px solid var(--xp-border)',
  borderRadius: '8px',
  padding: '10px 12px',
  marginBottom: '8px',
};

const sectionTitle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  color: 'var(--xp-text-muted)',
  marginBottom: '6px',
  display: 'flex',
  alignItems: 'center',
  gap: '5px',
};

const tag: (color: string) => React.CSSProperties = (color) => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '10px',
  fontSize: '10px',
  fontWeight: 500,
  marginRight: '4px',
  marginBottom: '4px',
  background: `${color}22`,
  color,
  border: `1px solid ${color}44`,
});

const kv: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '3px 0',
  fontSize: '11px',
  borderBottom: '1px solid var(--xp-border)',
};

const ArchitectPanel = ({ currentPath }: ArchitectPanelProps) => {
  const [data, setData] = useState<ArchData | null>(
    cachedAnalysis?.path === currentPath ? cachedAnalysis.data : null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const generate = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError('');

    try {
      const files = await TauriAPI.readDirectory(currentPath);
      const tree = files
        .sort((a, b) => (a.is_dir === b.is_dir ? a.name.localeCompare(b.name) : a.is_dir ? -1 : 1))
        .map((f) => `${f.is_dir ? 'd' : 'f'} ${f.name}`)
        .join('\n');

      const configFiles = [
        'package.json',
        'Cargo.toml',
        'tsconfig.json',
        'vite.config.ts',
        'docker-compose.yml',
        'pnpm-workspace.yaml',
      ];
      let configContent = '';
      for (const cf of configFiles) {
        const match = files.find((f) => f.name === cf);
        if (match) {
          try {
            const content = await TauriAPI.readTextFile(match.path);
            configContent += `\n--- ${cf} ---\n${content.slice(0, 2000)}\n`;
          } catch {
            /* skip */
          }
        }
      }

      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      const model = raw
        ? JSON.parse(raw).aiModel || 'claude-sonnet-4-20250514'
        : 'claude-sonnet-4-20250514';

      const prompt = `Analyze this project. Return ONLY valid JSON (no markdown, no explanation):

${tree}
${configContent}

Return this exact JSON structure:
{
  "projectType": "monorepo|fullstack|frontend|backend|library|cli",
  "description": "one sentence description",
  "frontend": { "framework": "React|Vue|...", "styling": "Tailwind|...", "stateManagement": "hooks|redux|...", "buildTool": "Vite|..." },
  "backend": { "language": "Rust|...", "framework": "Tauri|...", "database": "PostgreSQL|none", "runtime": "Tokio|..." },
  "patterns": ["IPC between frontend/backend", "..."],
  "entryPoints": [{ "file": "src/main.ts", "purpose": "Frontend entry" }],
  "techStack": ["React", "TypeScript", "Rust", "Tauri", "Tailwind"]
}`;

      const result = await TauriAPI.chatWithAI(model, [{ role: 'user', content: prompt }]);

      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('AI did not return valid JSON');
      const parsed = JSON.parse(jsonMatch[0]) as ArchData;
      setData(parsed);
      cachedAnalysis = { path: currentPath, data: parsed };
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [currentPath, isLoading]);

  const folderName = currentPath.split('/').filter(Boolean).pop() || currentPath;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div
        style={{ padding: '8px 12px', borderBottom: '1px solid var(--xp-border)', flexShrink: 0 }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '6px',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--xp-text)' }}>
            Architecture
          </div>
          <div style={{ fontSize: '10px', color: 'var(--xp-text-muted)' }}>{folderName}</div>
        </div>
        <button
          onClick={generate}
          disabled={isLoading}
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: '6px',
            border: 'none',
            background: 'var(--xp-blue)',
            color: 'white',
            fontSize: '11px',
            fontWeight: 500,
            cursor: isLoading ? 'wait' : 'pointer',
            opacity: isLoading ? 0.7 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
          }}
        >
          {isLoading ? (
            <>
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Analyzing...
            </>
          ) : data ? (
            <>
              <RefreshCw size={12} /> Regenerate
            </>
          ) : (
            <>
              <Sparkles size={12} /> Analyze with AI
            </>
          )}
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 10px',
          fontSize: '11px',
          color: 'var(--xp-text)',
        }}
      >
        {error && (
          <div
            style={{
              ...card,
              borderColor: 'var(--xp-red, #f87171)',
              color: 'var(--xp-red, #f87171)',
            }}
          >
            {error}
          </div>
        )}

        {!data && !isLoading && !error && (
          <div style={{ textAlign: 'center', color: 'var(--xp-text-muted)', paddingTop: '40px' }}>
            <Sparkles size={24} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
            <div style={{ fontSize: '12px' }}>Analyze this project</div>
            <div style={{ fontSize: '10px', marginTop: '2px' }}>with AI</div>
          </div>
        )}

        {data && (
          <>
            {/* Project type badge */}
            <div style={card}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}
              >
                <Box size={14} style={{ color: 'var(--xp-blue)' }} />
                <span style={{ fontSize: '13px', fontWeight: 600 }}>{data.projectType}</span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--xp-text-muted)', lineHeight: '1.4' }}>
                {data.description}
              </div>
            </div>

            {/* Tech stack tags */}
            <div style={card}>
              <div style={sectionTitle}>
                <Puzzle size={11} /> Tech Stack
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap' as const }}>
                {data.techStack.map((t) => (
                  <span key={t} style={tag(getBadgeColor(t))}>
                    {t}
                  </span>
                ))}
              </div>
            </div>

            {/* Frontend */}
            <div style={card}>
              <div style={sectionTitle}>
                <Palette size={11} /> Frontend
              </div>
              {Object.entries(data.frontend)
                .filter(([, v]) => v && v !== 'none' && v !== 'N/A')
                .map(([k, v]) => (
                  <div key={k} style={kv}>
                    <span
                      style={{
                        color: 'var(--xp-text-muted)',
                        textTransform: 'capitalize' as const,
                      }}
                    >
                      {k.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    <span style={{ fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
            </div>

            {/* Backend */}
            <div style={card}>
              <div style={sectionTitle}>
                <Server size={11} /> Backend
              </div>
              {Object.entries(data.backend)
                .filter(([, v]) => v && v !== 'none' && v !== 'N/A')
                .map(([k, v]) => (
                  <div key={k} style={kv}>
                    <span
                      style={{
                        color: 'var(--xp-text-muted)',
                        textTransform: 'capitalize' as const,
                      }}
                    >
                      {k.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    <span style={{ fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
            </div>

            {/* Patterns */}
            <div style={card}>
              <div style={sectionTitle}>
                <Layers size={11} /> Architecture Patterns
              </div>
              {data.patterns.map((p, i) => (
                <div
                  key={i}
                  style={{
                    padding: '3px 0',
                    fontSize: '11px',
                    display: 'flex',
                    gap: '6px',
                    alignItems: 'flex-start',
                  }}
                >
                  <GitBranch
                    size={10}
                    style={{ marginTop: '3px', flexShrink: 0, color: 'var(--xp-green, #9ece6a)' }}
                  />
                  <span>{p}</span>
                </div>
              ))}
            </div>

            {/* Entry points */}
            <div style={card}>
              <div style={sectionTitle}>
                <FileCode size={11} /> Entry Points
              </div>
              {data.entryPoints.map((ep, i) => (
                <div
                  key={i}
                  style={{
                    padding: '3px 0',
                    fontSize: '11px',
                    borderBottom:
                      i < data.entryPoints.length - 1 ? '1px solid var(--xp-border)' : 'none',
                  }}
                >
                  <code
                    style={{
                      fontSize: '10px',
                      background: 'var(--xp-surface-light)',
                      padding: '1px 4px',
                      borderRadius: '3px',
                    }}
                  >
                    {ep.file}
                  </code>
                  <div
                    style={{ color: 'var(--xp-text-muted)', fontSize: '10px', marginTop: '2px' }}
                  >
                    {ep.purpose}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default ArchitectPanel;
