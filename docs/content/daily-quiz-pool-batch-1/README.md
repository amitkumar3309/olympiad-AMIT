# Daily Quiz pool — batch 1

100 olympiad-style questions, 10 for each class from 3 to 12, for the automatic Daily Quiz's pool
(2026-10-11). Each class's pool gives one question a day, so this batch covers 10 days; after that a class
goes back to generated questions until more are added.

- `daily-quiz-pool-class-NN.csv` — one file per class, in the question importer's CSV format.
- `REVIEW.md` — every question with its options, the correct one marked, and the worked solution.
- `make_pool.py` — the questions as data, each with an independent check (brute force, simulation or exact
  arithmetic) that must agree with the stated answer before any file is written. 99 of the 100 are checked
  by code; the hundredth is a "who is the youngest" ordering puzzle.
- `make_review.py` — builds `REVIEW.md` from the CSV files.

## Uploading

Admin → **Bulk Import** → CSV. **Choose the file's class on the form** — the upload page files every
question under the class chosen there, not the file's Class column, which is why there is one file per
class. Then approve. The questions save as **drafts** tagged "daily quiz", which is what puts them in the
pool; they are never in Practice, and each is used once.

Tested on a copy of the site with the live chapter names: every file imports with no rejection, each class
pool holds 10, and the next automatic quiz for every class comes from the pool.

## Changing a question

Edit `make_pool.py`, then regenerate (Python 3, from this folder):

```bash
python make_pool.py .
python make_review.py .
```

The script refuses to write anything if a check disagrees with an answer, an option is duplicated, a class
does not have exactly 10, or a field contains a control character (a lost backslash in the maths). Write
LaTeX with doubled backslashes (`\\frac`) inside the Python strings.
