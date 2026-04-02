'use client';

import React from 'react';
import Image from 'next/image';
import { FolderOpen, Eye, Brain, Search, GitBranch, Puzzle, type LucideIcon } from 'lucide-react';
import { useInView } from '@/hooks/useInView';
import { cn } from '@/lib/utils';

interface Feature {
  icon: LucideIcon;
  label: string;
  title: string;
  description: string;
  iconBg: string;
  image: string;
  imageAlt: string;
}

const FEATURES: Feature[] = [
  {
    icon: FolderOpen,
    label: 'File Browsing',
    title: 'Navigate at the speed of thought.',
    description:
      'Grid, list, and column views with instant directory switching. Multi-selection, drag-and-drop, tabbed browsing, split panes, and an address bar that keeps up with you.',
    iconBg: 'bg-blue-500/10 text-blue-500 dark:bg-blue-500/20 dark:text-blue-400',
    image: '/demo1.png',
    imageAlt: 'Xplorer split view with AI chat analyzing project structure',
  },
  {
    icon: Eye,
    label: 'Rich Previews',
    title: 'Preview anything. Instantly.',
    description:
      'Images, PDFs, code with syntax highlighting, Office documents, video, audio, Markdown, CSV, archives — over 50 formats rendered inline without opening another app.',
    iconBg: 'bg-cyan-500/10 text-cyan-500 dark:bg-cyan-500/20 dark:text-cyan-400',
    image: '/demo2.png',
    imageAlt: 'File preview showing Python code with syntax highlighting and file properties',
  },
  {
    icon: Brain,
    label: 'AI Chat',
    title: 'Ask your files anything.',
    description:
      'Chat with AI models about your files. Get explanations, content summaries, and smart categorization — with full file context awareness.',
    iconBg: 'bg-purple-500/10 text-purple-500 dark:bg-purple-500/20 dark:text-purple-400',
    image: '/demo3.png',
    imageAlt: 'AI chat explaining a PDF document with context-aware responses',
  },
  {
    icon: Search,
    label: 'Smart Search',
    title: 'Search by meaning, not just name.',
    description:
      'Natural language queries with content indexing and semantic search. "Lecture about AI" or "PDF invoices over 1MB" — it just works.',
    iconBg: 'bg-amber-500/10 text-amber-500 dark:bg-amber-500/20 dark:text-amber-400',
    image: '/demo4.png',
    imageAlt: 'AI-powered search finding files by natural language query',
  },
  {
    icon: GitBranch,
    label: 'Git Integration',
    title: 'Your repo, at a glance.',
    description:
      'Commit graph, branch management, blame view, and file diffs — built right into the file explorer. See modified, staged, and untracked files without leaving the window.',
    iconBg: 'bg-orange-500/10 text-orange-500 dark:bg-orange-500/20 dark:text-orange-400',
    image: '/demo5.png',
    imageAlt: 'Git integration panel showing commit history and code diffs',
  },
  {
    icon: Puzzle,
    label: 'Extensions',
    title: 'Make it yours.',
    description:
      'Themes, custom previews, sidebar panels, commands, and context menus. A powerful SDK with a marketplace of 25 extensions and counting. Build and share your own plugins.',
    iconBg: 'bg-brand-500/10 text-brand-500 dark:bg-brand-500/20 dark:text-brand-400',
    image: '/demo7.png',
    imageAlt: 'Extension marketplace with developer tools, themes, and productivity plugins',
  },
];

const FeatureSection = ({
  feature,
  reversed,
  index,
}: {
  feature: Feature;
  reversed: boolean;
  index: number;
}) => {
  const { ref, inView } = useInView();
  const step = String(index + 1).padStart(2, '0');

  return (
    <div ref={ref} className={cn('grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20')}>
      {/* Text side */}
      <div className={cn(reversed && 'lg:order-2')}>
        <div className={`reveal ${inView ? 'visible' : ''}`}>
          <span className="mb-3 block select-none text-5xl font-black text-gray-100 dark:text-gray-800/60 sm:text-6xl">
            {step}
          </span>
          <div className="mb-4 inline-flex items-center gap-2 border-l-2 border-brand-500 pl-3 dark:border-brand-400">
            <div
              className={cn('flex h-8 w-8 items-center justify-center rounded-lg', feature.iconBg)}
            >
              <feature.icon className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {feature.label}
            </span>
          </div>
        </div>
        <h3
          className={`reveal ${inView ? 'visible' : ''} reveal-delay-1 text-3xl font-bold leading-tight text-gray-900 dark:text-white sm:text-4xl`}
        >
          {feature.title}
        </h3>
        <p
          className={`reveal ${inView ? 'visible' : ''} reveal-delay-2 mt-4 text-lg leading-relaxed text-gray-500 dark:text-gray-400`}
        >
          {feature.description}
        </p>
      </div>

      {/* Visual side */}
      <div className={cn(reversed && 'lg:order-1')}>
        <div className={`reveal ${inView ? 'visible' : ''} reveal-delay-2`}>
          <div className="window-glow relative overflow-hidden rounded-xl ring-1 ring-white/[0.08]">
            <Image
              src={feature.image}
              alt={feature.imageAlt}
              width={1920}
              height={1080}
              className="w-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export const FeatureShowcase = () => {
  const { ref: headerRef, inView: headerVisible } = useInView();

  return (
    <section className="bg-white py-24 dark:bg-gray-950 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div ref={headerRef} className="mb-20 text-center">
          <p
            className={`reveal ${headerVisible ? 'visible' : ''} text-sm font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400`}
          >
            Features
          </p>
          <h2
            className={`reveal ${headerVisible ? 'visible' : ''} reveal-delay-1 mt-2 text-4xl font-bold text-gray-900 dark:text-white sm:text-5xl`}
          >
            Everything you need.
          </h2>
          <p
            className={`reveal ${headerVisible ? 'visible' : ''} reveal-delay-2 mx-auto mt-4 max-w-2xl text-lg text-gray-500 dark:text-gray-400`}
          >
            A complete file management experience with modern tools built-in.
          </p>
        </div>

        {/* Feature list */}
        <div className="space-y-32 sm:space-y-40">
          {FEATURES.map((feature, i) => (
            <FeatureSection key={feature.label} feature={feature} reversed={i % 2 === 1} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
};
