import csv, glob, os, sys
d = sys.argv[1]
out = ['# Daily Quiz pool — batch 1 (100 questions, 10 per class)', '',
       'Every answer below was worked out independently by a script (brute force or exact arithmetic) before',
       'the files were written, and every file was imported on a test copy of the site with no rejections.',
       'Upload: Admin → Bulk Import → CSV, choose the file’s class on the form, then approve. They save as',
       'drafts tagged “daily quiz”, which is the automatic quiz’s pool — one is used per class per day.', '']
for path in sorted(glob.glob(os.path.join(d, 'daily-quiz-pool-class-*.csv'))):
    rows = list(csv.DictReader(open(path, encoding='utf-8-sig')))
    out.append(f"## {rows[0]['Class']} — `{os.path.basename(path)}`")
    out.append('')
    for i, r in enumerate(rows, 1):
        out.append(f"**{i}. {r['Question']}**  ")
        out.append(f"*{r['Topic']}*")
        out.append('')
        for letter in 'ABCD':
            mark = ' ✅' if letter == r['Correct Answer'] else ''
            out.append(f"- {letter}. {r['Option ' + letter]}{mark}")
        out.append('')
        out.append(f"> {r['Solution']}")
        out.append('')
open(os.path.join(d, 'REVIEW.md'), 'w', encoding='utf-8').write('\n'.join(out))
print('ok')
