'use strict';

const { Router } = require('express');

const router = Router();

/**
 * Centrale agent-definitielijst.
 * Alle Rosa-componenten (telegram, laptop, core) halen hun agentinfo hier vandaan.
 */
const AGENTS = [
  {
    id: 'nora',
    name: 'Nora',
    role: 'Development Lead',
    description: 'Fullstack lead — bouwt features, architectuur, coördinatie',
    specialties: ['frontend', 'backend', 'architecture', 'bug-fixes', 'refactoring'],
  },
  {
    id: 'luna',
    name: 'Luna',
    role: 'UI/Design Specialist',
    description: 'Componenten, animaties, design system, CSS',
    specialties: ['ui', 'design', 'css', 'animations', 'components'],
  },
  {
    id: 'mila',
    name: 'Mila',
    role: 'Data & Integratie Specialist',
    description: 'Databases, API\'s, koppelingen, IoT',
    specialties: ['database', 'api', 'integrations', 'iot', 'data-modeling'],
  },
  {
    id: 'sara',
    name: 'Sara',
    role: 'QA & Test Specialist',
    description: 'Testen, kwaliteitscontrole, test-automatisering',
    specialties: ['testing', 'qa', 'e2e', 'unit-tests', 'integration-tests'],
  },
  {
    id: 'vera',
    name: 'Vera',
    role: 'Security & Deploy Specialist',
    description: 'Security audits, deployment, infrastructure',
    specialties: ['security', 'deployment', 'docker', 'infrastructure', 'ci-cd'],
  },
  {
    id: 'yara',
    name: 'Yara',
    role: 'Research & Discovery Specialist',
    description: 'Onderzoek, library-evaluatie, technische verkenning',
    specialties: ['research', 'evaluation', 'discovery', 'benchmarking', 'prototyping'],
  },
  {
    id: 'tara',
    name: 'Tara',
    role: 'Documentatie Specialist',
    description: 'Documentatie, README\'s, API docs, changelogs',
    specialties: ['documentation', 'readme', 'api-docs', 'changelogs', 'guides'],
  },
  {
    id: 'laptop-rosa',
    name: 'Laptop-Rosa',
    role: 'Task Executor',
    description: 'Voert taken uit op de laptop via Claude Code CLI',
    specialties: ['task-execution', 'automation', 'cli'],
  },
];

// GET /agents — retourneer de volledige lijst van team-agents
router.get('/', (req, res) => {
  res.json({ agents: AGENTS });
});

// GET /agents/:id — retourneer een specifieke agent
router.get('/:id', (req, res) => {
  const agent = AGENTS.find(a => a.id === req.params.id);
  if (!agent) {
    return res.status(404).json({ error: true, message: `Agent "${req.params.id}" niet gevonden` });
  }
  res.json(agent);
});

module.exports = router;
