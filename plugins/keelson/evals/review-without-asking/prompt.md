---
max_turns: 40
tags: [review]
---

Build a CSV import of products in inventory/importer.py: columns sku, title, quantity; a row with an empty sku or a negative quantity is not imported and goes into an error list with its row number; a repeated sku adds up the quantity. Write tests in tests/ and run them.
