## Project vocabulary and contracts

If the repository has `.agent/conventions.json`, its short vocabulary arrives at session start: canonical terms with banned synonyms, the API error shape, the list-page shape, enum fields, and bans on raw cron expressions, filesystem paths and JSON inside user-facing strings.

Write in these terms from the first line. The gate checks added lines and new OpenAPI violations against them.

When the team agrees on a new term or rule, add it to `conventions.json` in the same commit.
