#!/usr/bin/env node
// A/B test plan for graph vs no-graph subagent tasks.
// This file defines the tasks; the actual subagent runs are orchestrated by
// the tech-lead agent invoking Task/Agent tools with the relevant MCP config.
// This script is a shared spec so all runs use identical prompts.

export const ECHOES_TASKS = [
  {
    id: 'whereis',
    description: 'Symbol location + neighbors',
    prompt: [
      'In the echoes_of_the_fallen codebase, find the ParticleRenderer class:',
      '1. What file is it defined in?',
      '2. What are its direct methods?',
      '3. What other classes/files depend on it?',
      '',
      'Report: file path, method names, and 3-5 callers or files that reference it.',
      'Be concise. Under 200 words.',
    ].join('\n'),
    successCriteria: [
      'Correct file path for ParticleRenderer',
      'At least 2 of its methods named',
      'At least 2 consumers identified',
    ],
  },
  {
    id: 'impact',
    description: 'Change impact / blast radius',
    prompt: [
      'In echoes_of_the_fallen, I want to change the signature of the Engine class constructor.',
      'Before I edit, tell me:',
      '1. How many places construct or reference Engine?',
      '2. What files would I need to update?',
      '3. Is it a safe change, review-needed, or should I confirm with someone first?',
      '',
      'Be concise. Under 200 words.',
    ].join('\n'),
    successCriteria: [
      'Count of call sites / references',
      'List of affected files',
      'Clear risk verdict',
    ],
  },
  {
    id: 'orient',
    description: 'Architecture orientation',
    prompt: [
      'I am a new developer on echoes_of_the_fallen. In under 200 words, orient me:',
      '1. What are the main modules/subsystems?',
      '2. Which files are the entry points?',
      '3. Where would I look first if I wanted to add a new enemy type?',
    ].join('\n'),
    successCriteria: [
      'Identifies 3-5 major subsystems',
      'Names at least one entry point',
      'Concrete file suggestion for enemy-type addition',
    ],
  },
];

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
    process.argv[1]?.endsWith('subagent-ab.mjs')) {
  // Printed for operators; real runs go through tech-lead-orchestrated subagents
  console.log(JSON.stringify(ECHOES_TASKS, null, 2));
}
