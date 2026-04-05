-- ── posts: add comments toggle ──────────────────────────────────────────────
ALTER TABLE posts ADD COLUMN IF NOT EXISTS comments_enabled boolean NOT NULL DEFAULT true;

-- ── comments ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL,
  parent_id  uuid REFERENCES comments(id) ON DELETE CASCADE,
  root_id    uuid NOT NULL,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  depth      int NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 8),
  path       text NOT NULL DEFAULT '',
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_comments_post_path ON comments (post_id, path);
CREATE INDEX idx_comments_post_created ON comments (post_id, created_at);
CREATE INDEX idx_comments_parent ON comments (parent_id);
CREATE INDEX idx_comments_root ON comments (root_id);

-- ── comment_votes ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comment_votes (
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  value      int NOT NULL CHECK (value IN (-1, 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

-- ── Server-side path/depth/root_id trigger ──────────────────────────────────
CREATE OR REPLACE FUNCTION compute_comment_hierarchy()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.root_id := NEW.id;
    NEW.depth   := 0;
    NEW.path    := NEW.id::text;
  ELSE
    SELECT root_id, depth, path
      INTO STRICT NEW.root_id, NEW.depth, NEW.path
      FROM comments WHERE id = NEW.parent_id;
    NEW.depth := NEW.depth + 1;
    NEW.path  := NEW.path || '.' || NEW.id::text;
    IF NEW.depth > 8 THEN
      RAISE EXCEPTION 'Maximum comment depth (8) exceeded';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_comment_hierarchy
  BEFORE INSERT ON comments
  FOR EACH ROW EXECUTE FUNCTION compute_comment_hierarchy();

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_votes ENABLE ROW LEVEL SECURITY;

-- Anyone can read comments
CREATE POLICY "comments_select" ON comments FOR SELECT USING (true);
-- Authenticated users can insert
CREATE POLICY "comments_insert" ON comments FOR INSERT
  WITH CHECK (auth.uid() = author_id);
-- Author can soft-delete own comments
CREATE POLICY "comments_update_own" ON comments FOR UPDATE
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

-- Anyone can read votes
CREATE POLICY "votes_select" ON comment_votes FOR SELECT USING (true);
-- Authenticated users can vote
CREATE POLICY "votes_insert" ON comment_votes FOR INSERT
  WITH CHECK (auth.uid() = user_id);
-- Users can change their own vote
CREATE POLICY "votes_update_own" ON comment_votes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- Users can remove their own vote
CREATE POLICY "votes_delete_own" ON comment_votes FOR DELETE
  USING (auth.uid() = user_id);

-- Post owner controls comments_enabled
-- (Assumes posts table has an author_id column)
-- CREATE POLICY "posts_toggle_comments" ON posts FOR UPDATE
--   USING (auth.uid() = author_id)
--   WITH CHECK (auth.uid() = author_id);
