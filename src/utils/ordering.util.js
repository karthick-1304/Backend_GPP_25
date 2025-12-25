// backend/src/utils/ordering.util.js (or similar)

export const makeSafeOrderingSets = async (conn, topicId, level) => {
  if (!conn || isNaN(topicId) || !['1', '2'].includes(level)) {
    throw new Error('Invalid connection, topic_id, or level');
  }

  try {
    const [sets] = await conn.execute(
      `SELECT set_id
       FROM practice_sets
       WHERE topic_id = ? AND level = ?
       ORDER BY display_order ASC, set_id ASC`,
      [topicId, level]
    );

    if (sets.length === 0) {
      return;
    }

    // Renumber display_order sequentially starting from 1
    for (let i = 0; i < sets.length; i++) {
      const newOrder = i + 1;
      await conn.execute(
        `UPDATE practice_sets
         SET display_order = ?
         WHERE set_id = ?`,
        [newOrder, sets[i].set_id]
      );
    }

    return { updated: sets.length, topic_id: topicId, level };

  } catch (err) {
    throw new Error(`Failed to reorder practice sets: ${err.message}`);
  }
};



export const makeSafeOrderingTopics = async (conn, subjectId) => {
  if (!conn || isNaN(subjectId)) {
    throw new Error('Invalid connection or subject_id');
  }

  try {
    const [topics] = await conn.execute(
      `SELECT topic_id
       FROM topics
       WHERE subject_id = ?
       ORDER BY display_order ASC, topic_id ASC`,
      [subjectId]
    );

    if (topics.length === 0) {
      return;
    }

    for (let i = 0; i < topics.length; i++) {
      const newOrder = i + 1;
      await conn.execute(
        `UPDATE topics
         SET display_order = ?
         WHERE topic_id = ?`,
        [newOrder, topics[i].topic_id]
      );
    }

    return { updated: topics.length, subject_id: subjectId };

  } catch (err) {
    throw new Error(`Failed to reorder topics: ${err.message}`);
  }
};


