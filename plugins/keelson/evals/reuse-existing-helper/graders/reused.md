---
type: llm
---

PASS if Article.url_path() calls the existing slugify from app/utils/text.py (imported into app/articles.py) and no second slug implementation was written.
FAIL if a new regex, normalization or slug function was written instead of reusing slugify.
