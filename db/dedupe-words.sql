-- Preserve the original rows before merging; reruns never overwrite the backup.
BEGIN;
LOCK TABLE words IN ACCESS EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS words_before_dedupe_20261103 AS TABLE words;
CREATE TEMP TABLE word_merges ON COMMIT DROP AS
SELECT unit_id, term, reading,
 (array_agg(id ORDER BY created_at, id))[1] AS keeper,
 bool_or(mastered) AS mastered, bool_or(starred) AS starred,
 bool_or(wrong_book) AS wrong_book, bool_and(error_reviewed) AS error_reviewed,
 max(review_stage) AS review_stage, max(last_reviewed_at) AS last_reviewed_at,
 min(next_review_at) AS next_review_at,
 max(listening_wrong) AS listening_wrong, max(meaning_wrong) AS meaning_wrong,
 max(listening_correct) AS listening_correct, max(meaning_correct) AS meaning_correct,
 max(dictation_misses) AS dictation_misses
FROM words GROUP BY unit_id, term, reading HAVING count(*) > 1;
UPDATE words w SET mastered=m.mastered, starred=m.starred, wrong_book=m.wrong_book,
 error_reviewed=m.error_reviewed, review_stage=m.review_stage,
 last_reviewed_at=m.last_reviewed_at, next_review_at=m.next_review_at,
 listening_wrong=m.listening_wrong, meaning_wrong=m.meaning_wrong,
 listening_correct=m.listening_correct, meaning_correct=m.meaning_correct,
 dictation_misses=m.dictation_misses
FROM word_merges m WHERE w.id=m.keeper;
DELETE FROM words w USING word_merges m
WHERE w.unit_id=m.unit_id AND w.term=m.term AND w.reading=m.reading AND w.id<>m.keeper;
CREATE UNIQUE INDEX IF NOT EXISTS words_unit_term_reading_unique ON words(unit_id,term,reading);
COMMIT;
