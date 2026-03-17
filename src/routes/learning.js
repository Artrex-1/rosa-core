'use strict';

const { Router } = require('express');
const { getDatabase } = require('../db/database');
const { sendError } = require('../utils/error-response');
const log = require('../utils/logger');

const router = Router();

const DEFAULT_LESSONS = [
  {
    category: 'assumption',
    mistake: 'Aannemen dat een tool beschikbaar is zonder te checken',
    lesson: 'Controleer altijd via list_files of get_projects of resources bestaan voordat je ze gebruikt',
    severity: 'high',
    source: 'manual'
  },
  {
    category: 'tool_use',
    mistake: 'Beschikbare tools niet gebruiken terwijl ze het probleem hadden kunnen oplossen',
    lesson: 'Bij elke vraag over bestandsstructuur of code, gebruik search_files of read_file direct',
    severity: 'high',
    source: 'manual'
  },
  {
    category: 'communication',
    mistake: 'Vage antwoorden geven zonder concrete actie te ondernemen',
    lesson: 'Geef altijd een concreet antwoord of actie, niet alleen beschrijvingen van wat zou kunnen',
    severity: 'medium',
    source: 'manual'
  },
  {
    category: 'assumption',
    mistake: 'Aannemen wat de gebruiker bedoelt zonder te vragen',
    lesson: 'Bij onduidelijke vragen: stel één gerichte verduidelijkingsvraag voordat je actie onderneemt',
    severity: 'medium',
    source: 'manual'
  },
  {
    category: 'technical',
    mistake: 'Fouten herhalen die al eerder zijn gemeld',
    lesson: 'Controleer altijd de lessons_learned via get_lessons tool voordat je een taak start',
    severity: 'high',
    source: 'manual'
  }
];

function seedDefaultLessons(db) {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM lessons_learned').get();
  if (count.cnt > 0) return;

  const stmt = db.prepare(`
    INSERT INTO lessons_learned (category, mistake, lesson, severity, source)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction((lessons) => {
    for (const l of lessons) {
      stmt.run(l.category, l.mistake, l.lesson, l.severity, l.source);
    }
  });

  insertAll(DEFAULT_LESSONS);
  log.info('Seeded default lessons', { count: DEFAULT_LESSONS.length });
}

// GET /learning/lessons
router.get('/lessons', (req, res) => {
  try {
    const db = getDatabase();
    seedDefaultLessons(db);

    const { category, severity } = req.query;
    let query = 'SELECT * FROM lessons_learned WHERE 1=1';
    const params = [];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    if (severity) {
      query += ' AND severity = ?';
      params.push(severity);
    }

    query += ' ORDER BY occurrence_count DESC, updated_at DESC';

    const lessons = db.prepare(query).all(...params);
    res.json({ lessons, count: lessons.length });
  } catch (err) {
    log.error('GET /lessons error', err);
    sendError(res, 500, 'Internal server error', null, req);
  }
});

// POST /learning/lessons
router.post('/lessons', (req, res) => {
  try {
    const db = getDatabase();
    const { category, mistake, lesson, context, source, severity } = req.body;

    if (!category || !mistake || !lesson) {
      return sendError(res, 400, 'category, mistake, and lesson are required', null, req);
    }
    if (mistake.length > 1000) {
      return sendError(res, 400, 'mistake exceeds maximum length (1000 chars)', null, req);
    }
    if (lesson.length > 2000) {
      return sendError(res, 400, 'lesson exceeds maximum length (2000 chars)', null, req);
    }
    if (context && context.length > 5000) {
      return sendError(res, 400, 'context exceeds maximum length (5000 chars)', null, req);
    }

    const result = db.prepare(`
      INSERT INTO lessons_learned (category, mistake, lesson, context, source, severity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      category,
      mistake,
      lesson,
      context || null,
      source || 'manual',
      severity || 'medium'
    );

    const created = db.prepare('SELECT * FROM lessons_learned WHERE rowid = ?').get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    log.error('POST /lessons error', err);
    sendError(res, 500, 'Internal server error', null, req);
  }
});

// PUT /learning/lessons/:id/increment
router.put('/lessons/:id/increment', (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;

    const result = db.prepare(`
      UPDATE lessons_learned
      SET occurrence_count = occurrence_count + 1,
          last_seen_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(id);

    if (result.changes === 0) {
      return sendError(res, 404, 'Lesson not found', null, req);
    }

    const updated = db.prepare('SELECT * FROM lessons_learned WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    log.error('PUT /lessons/:id/increment error', err);
    sendError(res, 500, 'Internal server error', null, req);
  }
});

// POST /learning/feedback
router.post('/feedback', (req, res) => {
  try {
    const db = getDatabase();
    const { user_id, session_id, message_content, rating, feedback_text, category, resolved_lesson_id } = req.body;

    if (!user_id) {
      return sendError(res, 400, 'user_id is required', null, req);
    }
    if (feedback_text && feedback_text.length > 5000) {
      return sendError(res, 400, 'feedback_text exceeds maximum length (5000 chars)', null, req);
    }
    if (message_content && message_content.length > 50000) {
      return sendError(res, 400, 'message_content exceeds maximum length (50000 chars)', null, req);
    }

    if (rating !== undefined && (rating < 1 || rating > 5)) {
      return sendError(res, 400, 'rating must be between 1 and 5', null, req);
    }

    const result = db.prepare(`
      INSERT INTO feedback (user_id, session_id, message_content, rating, feedback_text, category, resolved_lesson_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      user_id,
      session_id || null,
      message_content || null,
      rating || null,
      feedback_text || null,
      category || null,
      resolved_lesson_id || null
    );

    const created = db.prepare('SELECT * FROM feedback WHERE rowid = ?').get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    log.error('POST /feedback error', err);
    sendError(res, 500, 'Internal server error', null, req);
  }
});

// GET /learning/feedback
router.get('/feedback', (req, res) => {
  try {
    const db = getDatabase();
    const { rating, limit: rawLimit } = req.query;
    const limit = Math.min(parseInt(rawLimit) || 20, 200);

    let query = 'SELECT * FROM feedback WHERE 1=1';
    const params = [];

    if (rating) {
      query += ' AND rating = ?';
      params.push(parseInt(rating));
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const items = db.prepare(query).all(...params);
    res.json({ feedback: items, count: items.length });
  } catch (err) {
    log.error('GET /feedback error', err);
    sendError(res, 500, 'Internal server error', null, req);
  }
});

// GET /learning/context — top 10 lessen voor system prompt injectie
router.get('/context', (req, res) => {
  try {
    const db = getDatabase();
    seedDefaultLessons(db);

    const lessons = db.prepare(`
      SELECT category, lesson, occurrence_count
      FROM lessons_learned
      ORDER BY occurrence_count DESC, severity DESC
      LIMIT 10
    `).all();

    // Tally top mistake categories
    const categoryCounts = db.prepare(`
      SELECT category, SUM(occurrence_count) as total
      FROM lessons_learned
      GROUP BY category
      ORDER BY total DESC
    `).all();

    const topMistakes = categoryCounts.slice(0, 3).map(r => r.category);

    const topTwo = categoryCounts.slice(0, 2);
    let improvementAreas = 'Geen specifieke verbeterpunten gevonden';
    if (topTwo.length > 0) {
      const areas = topTwo.map(r => r.category).join(' en ');
      improvementAreas = `Rosa maakt de meeste fouten bij ${areas}`;
    }

    res.json({
      lessons: lessons.map(l => ({
        category: l.category,
        lesson: l.lesson,
        occurrences: l.occurrence_count
      })),
      top_mistakes: topMistakes,
      improvement_areas: improvementAreas
    });
  } catch (err) {
    log.error('GET /context error', err);
    sendError(res, 500, 'Internal server error', null, req);
  }
});

// POST /learning/analyze — analyseer recente fouten en maak patronen aan
router.post('/analyze', (req, res) => {
  try {
    const db = getDatabase();

    // Groepeer lessen per categorie met hoge occurrence counts
    const candidates = db.prepare(`
      SELECT category, COUNT(*) as lesson_count, SUM(occurrence_count) as total_occurrences
      FROM lessons_learned
      WHERE occurrence_count >= 2
      GROUP BY category
      HAVING total_occurrences >= 3
      ORDER BY total_occurrences DESC
    `).all();

    const insertPattern = db.prepare(`
      INSERT INTO error_patterns (pattern_type, description, occurrence_count, metadata)
      VALUES (?, ?, ?, ?)
    `);

    const updatePattern = db.prepare(`
      UPDATE error_patterns
      SET occurrence_count = occurrence_count + ?,
          last_seen = datetime('now')
      WHERE pattern_type = ? AND description LIKE ?
    `);

    const created = [];
    const updated = [];

    for (const candidate of candidates) {
      const description = `Herhaalde fouten in categorie: ${candidate.category} (${candidate.lesson_count} lessen, ${candidate.total_occurrences} voorvallen)`;
      const patternType = 'repeated_mistake';
      const metadata = JSON.stringify({ category: candidate.category, lesson_count: candidate.lesson_count });

      const existing = db.prepare(`
        SELECT id FROM error_patterns WHERE pattern_type = ? AND metadata LIKE ?
      `).get(patternType, `%"category":"${candidate.category}"%`);

      if (existing) {
        updatePattern.run(candidate.total_occurrences, patternType, `%${candidate.category}%`);
        updated.push(candidate.category);
      } else {
        insertPattern.run(patternType, description, candidate.total_occurrences, metadata);
        created.push(candidate.category);
      }
    }

    res.json({
      analyzed: candidates.length,
      patterns_created: created,
      patterns_updated: updated
    });
  } catch (err) {
    log.error('POST /analyze error', err);
    sendError(res, 500, 'Internal server error', null, req);
  }
});

module.exports = { router, seedDefaultLessons };
