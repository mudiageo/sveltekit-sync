---
"sveltekit-sync": patch
---

fix: merge existing data with new data in update operations

Previously, partial updates would lose existing object properties because only the new data was stored in the database. Now update operations properly merge existing data with incoming partial updates to preserve all properties.
