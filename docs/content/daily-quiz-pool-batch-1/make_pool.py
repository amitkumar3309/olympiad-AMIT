"""Daily Quiz pool, batch 1: 10 olympiad-style questions per class (3-12), each answer checked by code.

Usage: python make_pool.py <output folder>   (writes daily-quiz-pool-class-NN.csv; see README.md)

Every entry: (class, topic, question, correct, [3 wrong], solution, check)
`check` is a zero-argument function returning the correct answer independently (brute force,
simulation or exact arithmetic); the script refuses to write the file if any check disagrees.
"""
import csv, itertools, math, random, sys
from fractions import Fraction as Fr

Q = []
def q(cls, topic, text, correct, wrong, solution, check=None):
    Q.append(dict(cls=cls, topic=topic, text=text, correct=correct, wrong=wrong, solution=solution, check=check))

def count(it):
    return sum(1 for _ in it)

# ---------------------------------------------------------------- Class 3
q(3, 'Patterns', 'What comes next in the pattern 1, 4, 9, 16, 25, ...?', '36', ['30', '35', '49'],
  'These are $1 \\times 1$, $2 \\times 2$, $3 \\times 3$, $4 \\times 4$, $5 \\times 5$. Next is $6 \\times 6 = 36$.',
  lambda: str(6 * 6))
q(3, 'Numbers', 'How many two-digit numbers have digits that add up to 5?', '5', ['4', '6', '9'],
  'They are 14, 23, 32, 41 and 50 — five numbers. (05 is not a two-digit number.)',
  lambda: str(count(n for n in range(10, 100) if n // 10 + n % 10 == 5)))
q(3, 'Money', 'A pencil and an eraser cost ₹12 together. The pencil costs ₹4 more than the eraser. How much does the eraser cost?',
  '₹4', ['₹8', '₹6', '₹3'],
  'Take away the extra ₹4: ₹12 − ₹4 = ₹8 is two equal parts, so the eraser costs ₹4 (and the pencil ₹8).',
  lambda: '₹' + str(next(e for e in range(13) if e + (e + 4) == 12)))
q(3, 'Shapes', 'A big square is made of 4 small squares (2 rows of 2). How many squares of any size can you see?',
  '5', ['4', '6', '8'], '4 small squares and 1 big square: 5 squares.',
  lambda: str(sum((2 - s + 1) ** 2 for s in (1, 2))))
q(3, 'Time', 'Today is Monday. What day will it be 10 days from today?', 'Thursday', ['Wednesday', 'Friday', 'Tuesday'],
  '7 days from Monday is Monday again. 3 more days: Tuesday, Wednesday, Thursday.',
  lambda: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][10 % 7])
q(3, 'Numbers', 'Using the digits 3, 0 and 7 once each, make the largest and the smallest 3-digit numbers. What is their difference?',
  '423', ['427', '433', '703'], 'Largest: 730. Smallest (a 3-digit number cannot start with 0): 307. $730 - 307 = 423$.',
  lambda: str(max(int(''.join(p)) for p in itertools.permutations('307') if p[0] != '0')
              - min(int(''.join(p)) for p in itertools.permutations('307') if p[0] != '0')))
q(3, 'Patterns', 'Riya counts in 3s starting from 2: 2, 5, 8, 11, ... What is the 10th number she says?', '29', ['30', '32', '26'],
  'After the first number she adds 3 nine times: $2 + 9 \\times 3 = 29$.',
  lambda: str([2 + 3 * i for i in range(10)][-1]))
q(3, 'Measurement', 'A frog is at the bottom of a 10 m wall. Each day it climbs up 3 m, and each night it slips down 2 m. On which day does it reach the top?',
  'Day 8', ['Day 10', 'Day 7', 'Day 9'],
  'At the end of each night it is 1 m higher, so after 7 nights it is at 7 m. On day 8 it climbs 3 m and reaches 10 m — the top — before it can slip.',
  lambda: 'Day ' + str(next(d for d in range(1, 20) if (d - 1) * 1 + 3 >= 10)))
q(3, 'Numbers', 'You write all the numbers from 1 to 20. How many times do you write the digit 1?', '12', ['11', '10', '13'],
  'Ones place: 1 and 11 (2 times). Tens place: 10 to 19 (10 times). Total $2 + 10 = 12$.',
  lambda: str(''.join(str(n) for n in range(1, 21)).count('1')))
q(3, 'Patterns', 'Aman is older than Bina. Bina is older than Chetan. Dev is older than Aman. Who is the youngest?', 'Chetan', ['Bina', 'Aman', 'Dev'],
  'From oldest to youngest: Dev, Aman, Bina, Chetan. Chetan is the youngest.', None)

# ---------------------------------------------------------------- Class 4
q(4, 'Factors and Multiples', 'What is the smallest number greater than 1 that leaves a remainder of 1 when divided by 2, by 3, by 4 and by 5?',
  '61', ['31', '41', '121'], 'One less than the number must be divisible by 2, 3, 4 and 5. The smallest such number is 60, so the answer is $60 + 1 = 61$.',
  lambda: str(next(n for n in range(2, 1000) if all(n % d == 1 for d in (2, 3, 4, 5)))))
q(4, 'Addition and Subtraction', 'The sum of three numbers in a row (like 4, 5, 6) is 72. What is the largest of them?', '25', ['24', '23', '26'],
  'The middle number is $72 \\div 3 = 24$, so the numbers are 23, 24, 25. The largest is 25.',
  lambda: str(next(n + 2 for n in range(100) if n + n + 1 + n + 2 == 72)))
q(4, 'Perimeter and Area', 'A rectangle has a perimeter of 20 cm. Its length and width are different whole numbers of centimetres. What is the largest area it can have?',
  '24 square cm', ['25 square cm', '21 square cm', '16 square cm'],
  'Length + width = 10. The pairs are 9 and 1, 8 and 2, 7 and 3, 6 and 4. The largest area is $6 \\times 4 = 24$ square cm. (5 and 5 is not allowed: the sides must be different.)',
  lambda: str(max(l * (10 - l) for l in range(1, 10) if l != 10 - l)) + ' square cm')
q(4, 'Factors and Multiples', 'How many numbers from 1 to 100 are divisible by both 4 and 6?', '8', ['4', '12', '16'],
  'A number divisible by both 4 and 6 is a multiple of 12: 12, 24, ..., 96. That is 8 numbers.',
  lambda: str(count(n for n in range(1, 101) if n % 4 == 0 and n % 6 == 0)))
q(4, 'Numbers', 'In a class, 18 children like cricket, 15 like football and 7 like both. Every child likes at least one of them. How many children are in the class?',
  '26', ['33', '40', '19'], 'Adding 18 and 15 counts the 7 who like both twice: $18 + 15 - 7 = 26$.',
  lambda: str(18 + 15 - 7))
q(4, 'Numbers', 'What is the sum of all the digits used when you write the numbers from 1 to 20?', '102', ['210', '100', '93'],
  '1 to 9: 45. 10 to 19: ten tens digits (10) plus $0 + 1 + \\dots + 9 = 45$, so 55. 20: 2. Total $45 + 55 + 2 = 102$.',
  lambda: str(sum(int(d) for n in range(1, 21) for d in str(n))))
q(4, 'Fractions', 'Half of a number is 12 more than a quarter of it. What is the number?', '48', ['24', '36', '96'],
  'Half minus a quarter is a quarter, so a quarter of the number is 12. The number is $12 \\times 4 = 48$.',
  lambda: str(next(n for n in range(1, 500) if Fr(n, 2) == Fr(n, 4) + 12)))
q(4, 'Time', 'How many minutes are there from 9:45 AM to 1:20 PM on the same day?', '215 minutes', ['225 minutes', '205 minutes', '335 minutes'],
  '9:45 to 12:45 is 3 hours = 180 minutes; 12:45 to 1:20 is 35 minutes. $180 + 35 = 215$.',
  lambda: str((13 * 60 + 20) - (9 * 60 + 45)) + ' minutes')
q(4, 'Patterns', 'In the pattern 2, 6, 12, 20, 30, ..., what is the 8th number?', '72', ['56', '64', '90'],
  'The numbers are $1 \\times 2$, $2 \\times 3$, $3 \\times 4$, ... so the 8th is $8 \\times 9 = 72$.',
  lambda: str([n * (n + 1) for n in range(1, 9)][-1]))
q(4, 'Money', 'Tara has 8 coins, some ₹2 and some ₹5, worth ₹31 in all. How many ₹5 coins does she have?', '5', ['3', '4', '6'],
  'If all 8 were ₹2 coins she would have ₹16. Each ₹5 coin adds ₹3 more, and she needs ₹15 more: $15 \\div 3 = 5$ coins of ₹5 (and 3 of ₹2).',
  lambda: str(next(b for b in range(9) if 2 * (8 - b) + 5 * b == 31)))

# ---------------------------------------------------------------- Class 5
q(5, 'Factors and Multiples', 'What is the smallest 4-digit number that is divisible by 6, 8 and 9?', '1008', ['1080', '1012', '1152'],
  'The LCM of 6, 8 and 9 is 72. $72 \\times 13 = 936$ (3 digits) and $72 \\times 14 = 1008$.',
  lambda: str(next(n for n in range(1000, 10000) if n % 6 == 0 and n % 8 == 0 and n % 9 == 0)))
q(5, 'Data Handling', 'The average of 5 numbers is 20. When one number is removed, the average of the other 4 is 18. Which number was removed?',
  '28', ['2', '20', '38'], 'The 5 numbers add up to $5 \\times 20 = 100$; the 4 add up to $4 \\times 18 = 72$. The removed number is $100 - 72 = 28$.',
  lambda: str(5 * 20 - 4 * 18))
q(5, 'Perimeter and Area', 'A strip is made of 4 squares in a row. How many rectangles (of any size, squares included) can you find in it?',
  '10', ['4', '8', '12'], 'A rectangle runs from one of the 5 vertical lines to another: lengths 1, 2, 3, 4 give $4 + 3 + 2 + 1 = 10$ rectangles.',
  lambda: str(math.comb(5, 2)))
q(5, 'Speed, Distance and Time', 'A train 200 m long passes a pole in 10 seconds. What is its speed in km per hour?', '72 km per hour', ['20 km per hour', '36 km per hour', '120 km per hour'],
  'It covers its own length, 200 m, in 10 s: 20 m per second. $20 \\times 3600 \\div 1000 = 72$ km per hour.',
  lambda: str(200 // 10 * 3600 // 1000) + ' km per hour')
q(5, 'Multiplication', 'What is the last digit of 2 multiplied by itself 20 times?', '6', ['2', '4', '8'],
  'The last digits go 2, 4, 8, 6 and then repeat every 4 steps. 20 is a multiple of 4, so the last digit is 6.',
  lambda: str(pow(2, 20, 10)))
q(5, 'Percentage', 'A price goes up by 10% and then the new price goes down by 10%. Compared with the original price, the final price is:',
  '1% less', ['the same', '1% more', '10% less'],
  'Take ₹100: up 10% is ₹110; down 10% of ₹110 is ₹11, leaving ₹99 — 1% less than ₹100.',
  lambda: '1% less' if Fr(100) * Fr(11, 10) * Fr(9, 10) == 99 else None)
q(5, 'Fractions', 'What fraction of a day is 8 hours 20 minutes?', '$\\frac{25}{72}$', ['$\\frac{1}{3}$', '$\\frac{5}{18}$', '$\\frac{7}{24}$'],
  '8 h 20 min = 500 minutes, and a day has 1440 minutes. $\\frac{500}{1440} = \\frac{25}{72}$.',
  lambda: (lambda f: f'$\\frac{{{f.numerator}}}{{{f.denominator}}}$')(Fr(8 * 60 + 20, 1440)))
q(5, 'Angles', 'The angles of a triangle are in the ratio 1 : 2 : 3. What is the largest angle?', '90°', ['60°', '120°', '108°'],
  'The parts add up to 6 and the angles to 180°, so one part is 30°. The largest is $3 \\times 30° = 90°$.',
  lambda: str(180 // 6 * 3) + '°')
q(5, 'Numbers', 'How many 3-digit numbers have only odd digits?', '125', ['100', '150', '225'],
  'Each of the three places can be 1, 3, 5, 7 or 9: $5 \\times 5 \\times 5 = 125$.',
  lambda: str(count(n for n in range(100, 1000) if all(int(d) % 2 == 1 for d in str(n)))))
q(5, 'Division', 'A number leaves a remainder of 3 when divided by 7. What remainder does twice the number leave when divided by 7?', '6', ['3', '1', '0'],
  'Twice the number leaves twice the remainder: $2 \\times 3 = 6$, which is less than 7.',
  lambda: str(set((2 * n) % 7 for n in range(3, 200, 7)).pop()))

# ---------------------------------------------------------------- Class 6
q(6, 'Factors and Multiples', 'How many factors does 72 have?', '12', ['8', '10', '9'],
  '$72 = 2^3 \\times 3^2$, so it has $(3 + 1)(2 + 1) = 12$ factors: 1, 2, 3, 4, 6, 8, 9, 12, 18, 24, 36, 72.',
  lambda: str(count(d for d in range(1, 73) if 72 % d == 0)))
q(6, 'Integers', 'What is the value of $1 - 2 + 3 - 4 + \\dots + 99 - 100$?', '$-50$', ['$50$', '$0$', '$-100$'],
  'Pair them: $(1 - 2) + (3 - 4) + \\dots + (99 - 100)$ is 50 pairs of $-1$, so $-50$.',
  lambda: '$' + str(sum(n if n % 2 else -n for n in range(1, 101))) + '$')
q(6, 'Factors and Multiples', 'What is the smallest number that has exactly 6 factors?', '12', ['6', '18', '32'],
  '12 has 1, 2, 3, 4, 6, 12. Every number below 12 has fewer than 6 factors.',
  lambda: str(next(n for n in range(1, 200) if count(d for d in range(1, n + 1) if n % d == 0) == 6)))
q(6, 'Integers', 'How many integers $n$ satisfy $-3 < 2n + 1 < 9$?', '5', ['4', '6', '7'],
  'Subtract 1: $-4 < 2n < 8$, so $-2 < n < 4$. The integers are $-1, 0, 1, 2, 3$: five.',
  lambda: str(count(n for n in range(-50, 50) if -3 < 2 * n + 1 < 9)))
q(6, 'Ratio and Proportion', 'In a class the ratio of boys to girls is 3 : 5. When 6 more boys join, the numbers of boys and girls become equal. How many students were there at first?',
  '24', ['16', '30', '40'], 'Boys $3k$, girls $5k$. $3k + 6 = 5k$ gives $k = 3$: 9 boys and 15 girls, 24 students.',
  lambda: str(next(8 * k for k in range(1, 100) if 3 * k + 6 == 5 * k)))
q(6, 'Algebra', 'What is the 100th odd number?', '199', ['200', '201', '99'],
  'The $n$th odd number is $2n - 1$: $2 \\times 100 - 1 = 199$.',
  lambda: str([n for n in range(1, 1000) if n % 2][99]))
q(6, 'Mensuration', 'The side of a square is increased by 20%. By what percentage does its area increase?', '44%', ['20%', '40%', '42%'],
  'New side $= 1.2 \\times$ old, so new area $= 1.2^2 = 1.44 \\times$ old: an increase of 44%.',
  lambda: str(int((Fr(6, 5) ** 2 - 1) * 100)) + '%')
q(6, 'Numbers', 'How many digits are needed to number the pages of a book from 1 to 150?', '342', ['150', '450', '351'],
  'Pages 1–9: 9 digits. 10–99: $90 \\times 2 = 180$. 100–150: $51 \\times 3 = 153$. Total $9 + 180 + 153 = 342$.',
  lambda: str(sum(len(str(n)) for n in range(1, 151))))
q(6, 'Basic Geometry', 'How many diagonals does a hexagon have?', '9', ['6', '12', '15'],
  'Each of the 6 corners joins to 3 corners that are not its neighbours: $6 \\times 3 = 18$, and each diagonal was counted twice, so 9.',
  lambda: str(count(p for p in itertools.combinations(range(6), 2) if (p[1] - p[0]) % 6 not in (1, 5))))
q(6, 'Data Handling', 'The mean of five consecutive even numbers is 24. What is the largest of them?', '28', ['26', '30', '32'],
  'The mean of numbers spaced evenly is the middle one, 24. So they are 20, 22, 24, 26, 28.',
  lambda: str(next(a + 8 for a in range(0, 100, 2) if (5 * a + 20) == 5 * 24)))

# ---------------------------------------------------------------- Class 7
q(7, 'Exponents and Powers', 'What is the remainder when $3^{100}$ is divided by 5?', '1', ['3', '4', '2'],
  'Powers of 3 leave remainders 3, 4, 2, 1 and repeat every 4. 100 is a multiple of 4, so the remainder is 1.',
  lambda: str(pow(3, 100, 5)))
q(7, 'Simple Equations', 'If $x + \\frac{1}{x} = 3$, what is $x^2 + \\frac{1}{x^2}$?', '7', ['9', '11', '6'],
  'Square both sides: $x^2 + 2 + \\frac{1}{x^2} = 9$, so $x^2 + \\frac{1}{x^2} = 7$.',
  lambda: str(round((lambda x: x * x + 1 / (x * x))((3 + math.sqrt(5)) / 2))))
q(7, 'Triangles', 'One angle of a triangle is 80°. The other two are in the ratio 2 : 3. What is the largest angle of the triangle?', '80°', ['60°', '100°', '72°'],
  'The other two add up to 100°, in parts of 20°: 40° and 60°. The angles are 40°, 60°, 80°, so the largest is 80°.',
  lambda: str(max(80, 100 * 2 // 5, 100 * 3 // 5)) + '°')
q(7, 'Rational Numbers', 'What is the value of $\\left(1 - \\frac{1}{2}\\right)\\left(1 - \\frac{1}{3}\\right)\\left(1 - \\frac{1}{4}\\right) \\cdots \\left(1 - \\frac{1}{10}\\right)$?',
  '$\\frac{1}{10}$', ['$\\frac{1}{2}$', '$\\frac{9}{10}$', '$\\frac{1}{9}$'],
  'It is $\\frac{1}{2} \\times \\frac{2}{3} \\times \\frac{3}{4} \\times \\dots \\times \\frac{9}{10}$; everything cancels except $\\frac{1}{10}$.',
  lambda: (lambda f: f'$\\frac{{{f.numerator}}}{{{f.denominator}}}$')(math.prod(1 - Fr(1, n) for n in range(2, 11))))
q(7, 'Comparing Quantities', 'A shopkeeper marks an article 25% above its cost price and then gives a 20% discount on the marked price. What is the result?',
  'No profit, no loss', ['5% profit', '5% loss', '45% profit'],
  'Take cost ₹100. Marked price ₹125. 20% off ₹125 is ₹25, so he sells at ₹100 — exactly the cost.',
  lambda: 'No profit, no loss' if Fr(100) * Fr(5, 4) * Fr(4, 5) == 100 else None)
q(7, 'Exponents and Powers', 'Which is larger, $2^{30}$ or $3^{20}$?', '$3^{20}$', ['$2^{30}$', 'They are equal', 'It cannot be decided'],
  '$2^{30} = (2^3)^{10} = 8^{10}$ and $3^{20} = (3^2)^{10} = 9^{10}$. Since $9 > 8$, $3^{20}$ is larger.',
  lambda: '$3^{20}$' if 3 ** 20 > 2 ** 30 else '$2^{30}$')
q(7, 'Simple Equations', 'A father is three times as old as his son. In 12 years he will be twice as old as his son. How old is the son now?', '12 years', ['24 years', '36 years', '6 years'],
  'Son $s$, father $3s$. $3s + 12 = 2(s + 12)$ gives $s = 12$.',
  lambda: str(next(s for s in range(1, 100) if 3 * s + 12 == 2 * (s + 12))) + ' years')
q(7, 'Perimeter and Area', 'A path 2 m wide runs all around the outside of a 20 m by 10 m garden. What is the area of the path?', '136 square m', ['120 square m', '124 square m', '200 square m'],
  'With the path, the outer rectangle is 24 m by 14 m = 336 square m. Take away the garden, 200 square m: $336 - 200 = 136$.',
  lambda: str((20 + 4) * (10 + 4) - 20 * 10) + ' square m')
q(7, 'Triangles', 'Six points are marked on a circle. How many different triangles can be drawn with their corners at three of these points?', '20', ['18', '15', '120'],
  'Any 3 of the 6 points make a triangle (no three points on a circle are in a line). Choosing 3 from 6: $\\frac{6 \\times 5 \\times 4}{3 \\times 2 \\times 1} = 20$.',
  lambda: str(count(itertools.combinations(range(6), 3))))
q(7, 'Lines and Angles', 'The interior angles of a polygon add up to 1440°. How many sides does it have?', '10', ['8', '9', '12'],
  'The angles of an $n$-sided polygon add up to $(n - 2) \\times 180°$. $1440 \\div 180 = 8$, so $n = 10$.',
  lambda: str(next(n for n in range(3, 50) if (n - 2) * 180 == 1440)))

# ---------------------------------------------------------------- Class 8
q(8, 'Exponents and Powers', 'What is the units digit of $7^{2026}$?', '9', ['7', '3', '1'],
  'Units digits of powers of 7 repeat 7, 9, 3, 1. $2026 = 4 \\times 506 + 2$, so the units digit is the second one, 9.',
  lambda: str(pow(7, 2026, 10)))
q(8, 'Algebraic Expressions and Identities', 'If $a + b = 10$ and $ab = 21$, what is $a^2 + b^2$?', '58', ['79', '100', '42'],
  '$a^2 + b^2 = (a + b)^2 - 2ab = 100 - 42 = 58$.',
  lambda: str(3 * 3 + 7 * 7))
q(8, 'Squares and Square Roots', 'How many perfect squares lie between 50 and 500?', '15', ['14', '16', '22'],
  'The smallest is $8^2 = 64$ and the largest $22^2 = 484$: from 8 to 22 is 15 numbers.',
  lambda: str(count(n for n in range(51, 500) if math.isqrt(n) ** 2 == n)))
q(8, 'Cubes and Cube Roots', 'What is $\\sqrt[3]{0.000216}$?', '0.06', ['0.6', '0.006', '0.0006'],
  '$0.000216 = \\frac{216}{1000000}$, and $\\sqrt[3]{216} = 6$, $\\sqrt[3]{1000000} = 100$. So the cube root is $\\frac{6}{100} = 0.06$.',
  lambda: '0.06' if Fr(6, 100) ** 3 == Fr(216, 1000000) else None)
q(8, 'Comparing Quantities', 'A sum of money doubles in 5 years at compound interest. In how many years will it become 8 times itself?', '15 years', ['20 years', '40 years', '10 years'],
  'It doubles every 5 years: 2 times after 5, 4 times after 10, 8 times after 15 years.',
  lambda: str(5 * int(math.log2(8))) + ' years')
q(8, 'Factorisation', 'What is $101^2 - 99^2$?', '400', ['4', '200', '40'],
  '$a^2 - b^2 = (a + b)(a - b) = 200 \\times 2 = 400$.',
  lambda: str(101 ** 2 - 99 ** 2))
q(8, 'Direct and Inverse Proportions', '12 workers can finish a job in 10 days. After 4 days of work, 4 of the workers leave. How many more days will the rest take to finish?', '9 days', ['6 days', '8 days', '12 days'],
  'The job is $12 \\times 10 = 120$ worker-days. After 4 days, $120 - 48 = 72$ remain, done by 8 workers: $72 \\div 8 = 9$ days.',
  lambda: str((12 * 10 - 12 * 4) // 8) + ' days')
q(8, 'Probability', 'Two coins are tossed together. What is the probability of getting at least one head?', '$\\frac{3}{4}$', ['$\\frac{1}{2}$', '$\\frac{1}{4}$', '$\\frac{2}{3}$'],
  'The outcomes are HH, HT, TH, TT. Three of the four have a head: $\\frac{3}{4}$.',
  lambda: (lambda f: f'$\\frac{{{f.numerator}}}{{{f.denominator}}}$')(Fr(count(o for o in itertools.product('HT', repeat=2) if 'H' in o), 4)))
q(8, 'Understanding Quadrilaterals', 'Each interior angle of a regular polygon is 156°. How many sides does it have?', '15', ['12', '18', '20'],
  'Each exterior angle is $180° - 156° = 24°$, and the exterior angles add up to 360°: $360 \\div 24 = 15$.',
  lambda: str(360 // (180 - 156)))
q(8, 'Mensuration', 'A cube of side 4 cm is painted on all its faces and then cut into 1 cm cubes. How many small cubes have paint on exactly two faces?', '24', ['8', '12', '32'],
  'Those are the cubes along the edges, not at the corners: each of the 12 edges has $4 - 2 = 2$ of them, so 24.',
  lambda: str(count(c for c in itertools.product(range(4), repeat=3) if sum(v in (0, 3) for v in c) == 2)))

# ---------------------------------------------------------------- Class 9
q(9, 'Number Systems', 'If $x = 2 + \\sqrt{3}$, what is $x^2 + \\frac{1}{x^2}$?', '14', ['16', '12', '$8 + 4\\sqrt{3}$'],
  '$\\frac{1}{x} = 2 - \\sqrt{3}$, so $x + \\frac{1}{x} = 4$. Then $x^2 + \\frac{1}{x^2} = 4^2 - 2 = 14$.',
  lambda: str(round((2 + math.sqrt(3)) ** 2 + (2 + math.sqrt(3)) ** -2)))
q(9, 'Polynomials', 'If $p(x) = x^2 - 4x + 3$, what is $p(2) - p(1) + p\\left(\\frac{1}{2}\\right)$?', '$\\frac{1}{4}$', ['$-\\frac{1}{4}$', '$\\frac{5}{4}$', '$0$'],
  '$p(2) = 4 - 8 + 3 = -1$, $p(1) = 1 - 4 + 3 = 0$ and $p\\left(\\frac{1}{2}\\right) = \\frac{1}{4} - 2 + 3 = \\frac{5}{4}$. So $-1 - 0 + \\frac{5}{4} = \\frac{1}{4}$.',
  lambda: (lambda p: (lambda f: f'$\\frac{{{f.numerator}}}{{{f.denominator}}}$')(p(Fr(2)) - p(Fr(1)) + p(Fr(1, 2))))(lambda x: x * x - 4 * x + 3))
q(9, 'Number Systems', 'Written as $a + b\\sqrt{15}$, what is $\\frac{\\sqrt{5} + \\sqrt{3}}{\\sqrt{5} - \\sqrt{3}}$?', '$4 + \\sqrt{15}$', ['$8 + 2\\sqrt{15}$', '$1 + \\sqrt{15}$', '$4 - \\sqrt{15}$'],
  'Multiply top and bottom by $\\sqrt{5} + \\sqrt{3}$: $\\frac{5 + 3 + 2\\sqrt{15}}{5 - 3} = \\frac{8 + 2\\sqrt{15}}{2} = 4 + \\sqrt{15}$.',
  lambda: '$4 + \\sqrt{15}$' if abs((math.sqrt(5) + math.sqrt(3)) / (math.sqrt(5) - math.sqrt(3)) - (4 + math.sqrt(15))) < 1e-9 else None)
q(9, 'Linear Equations in Two Variables', 'How many pairs of positive whole numbers $(x, y)$ satisfy $2x + 3y = 20$?', '3', ['2', '4', '6'],
  '$3y$ must be even and less than 20, so $y = 2, 4, 6$, giving $x = 7, 4, 1$. Three pairs.',
  lambda: str(count((x, y) for x in range(1, 20) for y in range(1, 20) if 2 * x + 3 * y == 20)))
q(9, "Heron's Formula", 'A triangle has sides 13 cm, 14 cm and 15 cm. How long is the altitude drawn to the 14 cm side?', '12 cm', ['13 cm', '11 cm', '84 cm'],
  "By Heron's formula, $s = 21$ and the area is $\\sqrt{21 \\times 8 \\times 7 \\times 6} = 84$. Altitude $= \\frac{2 \\times 84}{14} = 12$ cm.",
  lambda: str(round(2 * math.sqrt(21 * 8 * 7 * 6) / 14)) + ' cm')
q(9, 'Circles', 'A chord subtends an angle of 100° at the centre of a circle. What angle does it subtend at a point on the major arc?', '50°', ['100°', '130°', '80°'],
  'The angle at the centre is twice the angle at any point on the remaining (major) arc: $100° \\div 2 = 50°$.',
  lambda: str(100 // 2) + '°')
q(9, 'Statistics', 'The mean of 10 observations is 20. Later it is found that one observation, 30, was wrongly recorded as 50. What is the correct mean?', '18', ['22', '19', '20'],
  'The recorded total is 200. Correct total $= 200 - 50 + 30 = 180$, so the mean is 18.',
  lambda: str((10 * 20 - 50 + 30) // 10))
q(9, 'Number Systems', 'Which fraction equals $0.2\\overline{3}$ (that is, 0.2333...)?', '$\\frac{7}{30}$', ['$\\frac{23}{99}$', '$\\frac{23}{90}$', '$\\frac{2}{9}$'],
  'Let $x = 0.2333\\ldots$ Then $10x = 2.333\\ldots$ and $100x = 23.333\\ldots$, so $90x = 21$ and $x = \\frac{21}{90} = \\frac{7}{30}$.',
  lambda: (lambda f: f'$\\frac{{{f.numerator}}}{{{f.denominator}}}$')(Fr(2, 10) + Fr(3, 90)))
q(9, 'Polynomials', 'If $a + b + c = 0$, what does $a^3 + b^3 + c^3$ equal?', '$3abc$', ['$0$', '$abc$', '$a^2b^2c^2$'],
  '$a^3 + b^3 + c^3 - 3abc = (a + b + c)(a^2 + b^2 + c^2 - ab - bc - ca)$, which is 0 when $a + b + c = 0$.',
  lambda: '$3abc$' if all(a ** 3 + b ** 3 + (-a - b) ** 3 == 3 * a * b * (-a - b) for a in range(-5, 6) for b in range(-5, 6)) else None)
q(9, 'Lines and Angles', 'Two parallel lines are cut by a transversal. The two interior angles on the same side of the transversal are $3x$ and $2x$. What is $x$?', '36°', ['18°', '72°', '45°'],
  'Co-interior angles add up to 180°: $5x = 180°$, so $x = 36°$.',
  lambda: str(180 // 5) + '°')

# ---------------------------------------------------------------- Class 10
q(10, 'Arithmetic Progressions', 'The sum of the first $n$ odd numbers is 625. What is $n$?', '25', ['24', '50', '125'],
  'The sum of the first $n$ odd numbers is $n^2$. $n^2 = 625$, so $n = 25$.',
  lambda: str(next(n for n in range(1, 100) if sum(range(1, 2 * n, 2)) == 625)))
q(10, 'Quadratic Equations', 'If $\\alpha$ and $\\beta$ are the roots of $x^2 - 5x + 6 = 0$, what is $\\alpha^2 + \\beta^2$?', '13', ['25', '19', '36'],
  '$\\alpha + \\beta = 5$ and $\\alpha\\beta = 6$, so $\\alpha^2 + \\beta^2 = 25 - 12 = 13$.',
  lambda: str(2 ** 2 + 3 ** 2))
q(10, 'Arithmetic Progressions', 'How many terms of the AP 9, 17, 25, ... must be added to get a sum of 636?', '12', ['10', '11', '14'],
  '$S_n = \\frac{n}{2}[18 + 8(n - 1)] = n(4n + 5) = 636$. So $4n^2 + 5n - 636 = 0$, and $n = 12$.',
  lambda: str(next(n for n in range(1, 100) if sum(9 + 8 * i for i in range(n)) == 636)))
q(10, 'Pair of Linear Equations', 'For what value of $k$ do $2x + 3y = 7$ and $4x + ky = 14$ have infinitely many solutions?', '6', ['3', '12', '$-6$'],
  'The lines must be the same: $\\frac{2}{4} = \\frac{3}{k} = \\frac{7}{14}$, so $k = 6$.',
  lambda: str(next(k for k in range(-20, 20) if 2 * k == 3 * 4 and 2 * 14 == 7 * 4)))
q(10, 'Introduction to Trigonometry', 'If $\\sin\\theta + \\cos\\theta = \\sqrt{2}$, what is $\\sin\\theta\\cos\\theta$?', '$\\frac{1}{2}$', ['$1$', '$\\frac{1}{\\sqrt{2}}$', '$0$'],
  'Square: $1 + 2\\sin\\theta\\cos\\theta = 2$, so $\\sin\\theta\\cos\\theta = \\frac{1}{2}$.',
  lambda: '$\\frac{1}{2}$' if abs(math.sin(math.pi / 4) * math.cos(math.pi / 4) - 0.5) < 1e-12 else None)
q(10, 'Coordinate Geometry', 'Which point on the x-axis is equidistant from $(2, -5)$ and $(-2, 9)$?', '$(-7, 0)$', ['$(7, 0)$', '$(0, 2)$', '$(-2, 0)$'],
  'For $(x, 0)$: $(x - 2)^2 + 25 = (x + 2)^2 + 81$, so $-8x = 56$ and $x = -7$.',
  lambda: '$(' + str(next(x for x in range(-50, 50) if (x - 2) ** 2 + 25 == (x + 2) ** 2 + 81)) + ', 0)$')
q(10, 'Real Numbers', 'What is the smallest number that leaves a remainder of 7 when divided by 12, by 15 and by 20?', '67', ['60', '127', '187'],
  'The number minus 7 is a multiple of 12, 15 and 20, whose LCM is 60. So the number is $60 + 7 = 67$.',
  lambda: str(next(n for n in range(8, 1000) if all(n % d == 7 for d in (12, 15, 20)))))
q(10, 'Probability', 'A number is chosen at random from 1 to 50. What is the probability that it is a perfect square or a perfect cube?', '$\\frac{9}{50}$', ['$\\frac{10}{50}$', '$\\frac{7}{50}$', '$\\frac{3}{50}$'],
  'Squares: 1, 4, 9, 16, 25, 36, 49 (7). Cubes: 1, 8, 27 (3). 1 is both. $7 + 3 - 1 = 9$, so $\\frac{9}{50}$.',
  lambda: '$\\frac{' + str(count(n for n in range(1, 51) if math.isqrt(n) ** 2 == n or round(n ** (1 / 3)) ** 3 == n)) + '}{50}$')
q(10, 'Applications of Trigonometry', 'A pole 10 m tall casts a shadow $10\\sqrt{3}$ m long. What is the angle of elevation of the sun?', '30°', ['60°', '45°', '90°'],
  '$\\tan\\theta = \\frac{10}{10\\sqrt{3}} = \\frac{1}{\\sqrt{3}}$, so $\\theta = 30°$.',
  lambda: str(round(math.degrees(math.atan(10 / (10 * math.sqrt(3)))))) + '°')
q(10, 'Surface Areas and Volumes', 'A metal sphere of radius 6 cm is melted and recast into a cylinder of radius 4 cm. What is the height of the cylinder?', '18 cm', ['12 cm', '24 cm', '9 cm'],
  'Volumes are equal: $\\frac{4}{3}\\pi \\times 216 = \\pi \\times 16 \\times h$, so $288 = 16h$ and $h = 18$ cm.',
  lambda: str(int(Fr(4, 3) * 216 / 16)) + ' cm')

# ---------------------------------------------------------------- Class 11
q(11, 'Sets', 'A set has 5 elements. How many of its subsets have at least 2 elements?', '26', ['32', '31', '25'],
  'There are $2^5 = 32$ subsets. Remove the empty set and the 5 one-element subsets: $32 - 1 - 5 = 26$.',
  lambda: str(count(s for r in range(6) for s in itertools.combinations(range(5), r) if len(s) >= 2)))
q(11, 'Permutations and Combinations', 'In how many different ways can the letters of the word LEVEL be arranged?', '30', ['120', '60', '20'],
  'Five letters with L twice and E twice: $\\frac{5!}{2! \\times 2!} = 30$.',
  lambda: str(len(set(itertools.permutations('LEVEL')))))
q(11, 'Binomial Theorem', 'What is the coefficient of $x^3$ in the expansion of $(1 + 2x)^5$?', '80', ['40', '10', '160'],
  'The term is $\\binom{5}{3}(2x)^3 = 10 \\times 8x^3 = 80x^3$.',
  lambda: str(math.comb(5, 3) * 2 ** 3))
q(11, 'Complex Numbers', 'If $z = 1 + i$, what is $z^8$?', '$16$', ['$-16$', '$16i$', '$256$'],
  '$z^2 = 2i$, so $z^8 = (2i)^4 = 16i^4 = 16$.',
  lambda: '$' + str(round(((1 + 1j) ** 8).real)) + '$')
q(11, 'Sequences and Series', 'What is the sum to infinity of $1 + \\frac{1}{3} + \\frac{1}{9} + \\frac{1}{27} + \\dots$?', '$\\frac{3}{2}$', ['$\\frac{4}{3}$', '$2$', '$3$'],
  'A GP with $a = 1$, $r = \\frac{1}{3}$: $\\frac{a}{1 - r} = \\frac{1}{2/3} = \\frac{3}{2}$.',
  lambda: (lambda f: f'$\\frac{{{f.numerator}}}{{{f.denominator}}}$')(1 / (1 - Fr(1, 3))))
q(11, 'Limits and Derivatives', 'What is $\\lim_{x \\to 0} \\frac{\\sin 5x}{x}$?', '5', ['1', '0', '$\\frac{1}{5}$'],
  '$\\frac{\\sin 5x}{x} = 5 \\times \\frac{\\sin 5x}{5x} \\to 5 \\times 1 = 5$.',
  lambda: str(round(math.sin(5e-7) / 1e-7)))
q(11, 'Straight Lines', 'What is the distance between the parallel lines $3x + 4y = 5$ and $3x + 4y = 15$?', '2', ['10', '$\\frac{2}{5}$', '4'],
  'Distance $= \\frac{|15 - 5|}{\\sqrt{3^2 + 4^2}} = \\frac{10}{5} = 2$.',
  lambda: str(int(abs(15 - 5) / math.hypot(3, 4))))
q(11, 'Permutations and Combinations', 'How many diagonals does a decagon (10-sided polygon) have?', '35', ['45', '40', '70'],
  'Choose 2 of the 10 corners in $\\binom{10}{2} = 45$ ways; 10 of those pairs are sides. $45 - 10 = 35$.',
  lambda: str(count(p for p in itertools.combinations(range(10), 2) if (p[1] - p[0]) % 10 not in (1, 9))))
q(11, 'Permutations and Combinations', 'How many 4-digit numbers have all four digits different?', '4536', ['5040', '3024', '4500'],
  'First digit: 9 choices (not 0). Then 9, 8 and 7 choices: $9 \\times 9 \\times 8 \\times 7 = 4536$.',
  lambda: str(count(n for n in range(1000, 10000) if len(set(str(n))) == 4)))
q(11, 'Trigonometric Functions', 'If $\\tan A = \\frac{1}{2}$ and $\\tan B = \\frac{1}{3}$, with $A$ and $B$ acute, what is $A + B$?', '45°', ['30°', '60°', '90°'],
  '$\\tan(A + B) = \\frac{\\frac{1}{2} + \\frac{1}{3}}{1 - \\frac{1}{6}} = \\frac{5/6}{5/6} = 1$, so $A + B = 45°$.',
  lambda: str(round(math.degrees(math.atan(0.5) + math.atan(1 / 3)))) + '°')

# ---------------------------------------------------------------- Class 12
q(12, 'Integrals', 'What is $\\int_0^{\\pi/2} \\sin^2 x \\, dx$?', '$\\frac{\\pi}{4}$', ['$\\frac{\\pi}{2}$', '$1$', '$\\frac{1}{2}$'],
  '$\\sin^2 x = \\frac{1 - \\cos 2x}{2}$, so the integral is $\\left[\\frac{x}{2} - \\frac{\\sin 2x}{4}\\right]_0^{\\pi/2} = \\frac{\\pi}{4}$.',
  lambda: '$\\frac{\\pi}{4}$' if abs(sum(math.sin((i + 0.5) * (math.pi / 2) / 100000) ** 2 for i in range(100000)) * (math.pi / 2) / 100000 - math.pi / 4) < 1e-6 else None)
q(12, 'Determinants', '$A$ is a $3 \\times 3$ matrix with $|A| = 4$. What is $|2A|$?', '32', ['8', '16', '64'],
  'Multiplying every entry of a $3 \\times 3$ matrix by 2 multiplies the determinant by $2^3$: $8 \\times 4 = 32$.',
  lambda: str(2 ** 3 * 4))
q(12, 'Continuity and Differentiability', 'What is the derivative of $x^x$ at $x = 1$?', '1', ['0', '$e$', '2'],
  '$\\frac{d}{dx}x^x = x^x(1 + \\ln x)$. At $x = 1$: $1 \\times (1 + 0) = 1$.',
  lambda: str(round(((1 + 1e-7) ** (1 + 1e-7) - 1) / 1e-7)))
q(12, 'Integrals', 'What is $\\int_{-1}^{1} x^3 \\cos x \\, dx$?', '0', ['2', '1', '$2\\cos 1$'],
  '$x^3\\cos x$ is an odd function, and the integral of an odd function over $[-a, a]$ is 0.',
  lambda: str(round(sum(((-1 + (i + 0.5) * 2 / 10000) ** 3) * math.cos(-1 + (i + 0.5) * 2 / 10000) for i in range(10000)) * 2 / 10000) + 0))
q(12, 'Probability', 'If $P(A) = 0.5$, $P(B) = 0.4$ and $P(A \\cup B) = 0.7$, what is $P(A \\mid B)$?', '0.5', ['0.4', '0.2', '0.8'],
  '$P(A \\cap B) = 0.5 + 0.4 - 0.7 = 0.2$, so $P(A \\mid B) = \\frac{0.2}{0.4} = 0.5$.',
  lambda: str(float((Fr(1, 2) + Fr(2, 5) - Fr(7, 10)) / Fr(2, 5))))
q(12, 'Applications of Integrals', 'What is the area enclosed between $y = x^2$ and $y = x$?', '$\\frac{1}{6}$', ['$\\frac{1}{3}$', '$\\frac{1}{2}$', '$\\frac{5}{6}$'],
  'They meet at $x = 0$ and $x = 1$. Area $= \\int_0^1 (x - x^2)\\,dx = \\frac{1}{2} - \\frac{1}{3} = \\frac{1}{6}$.',
  lambda: (lambda f: f'$\\frac{{{f.numerator}}}{{{f.denominator}}}$')(Fr(1, 2) - Fr(1, 3)))
q(12, 'Applications of Derivatives', 'What is the maximum value of $\\sin x + \\cos x$?', '$\\sqrt{2}$', ['$2$', '$1$', '$\\frac{1}{\\sqrt{2}}$'],
  '$\\sin x + \\cos x = \\sqrt{2}\\sin\\left(x + \\frac{\\pi}{4}\\right)$, whose largest value is $\\sqrt{2}$.',
  lambda: '$\\sqrt{2}$' if abs(max(math.sin(t / 1000) + math.cos(t / 1000) for t in range(6284)) - math.sqrt(2)) < 1e-6 else None)
q(12, 'Vector Algebra', 'What is the projection of $\\vec{a} = 2\\hat{i} + 3\\hat{j} + 2\\hat{k}$ on $\\vec{b} = \\hat{i} + 2\\hat{j} + \\hat{k}$?', '$\\frac{5\\sqrt{6}}{3}$', ['$\\frac{10}{3}$', '$10$', '$\\sqrt{6}$'],
  'Projection $= \\frac{\\vec{a} \\cdot \\vec{b}}{|\\vec{b}|} = \\frac{2 + 6 + 2}{\\sqrt{6}} = \\frac{10}{\\sqrt{6}} = \\frac{5\\sqrt{6}}{3}$.',
  lambda: '$\\frac{5\\sqrt{6}}{3}$' if abs(10 / math.sqrt(6) - 5 * math.sqrt(6) / 3) < 1e-12 else None)
q(12, 'Differential Equations', 'If $\\frac{dy}{dx} = y$ and $y(0) = 2$, what is $y$ when $x = \\ln 3$?', '6', ['3', '2', '$2\\ln 3$'],
  'The solution is $y = 2e^x$, so $y(\\ln 3) = 2 \\times 3 = 6$.',
  lambda: str(round(2 * math.exp(math.log(3)))))
q(12, 'Relations and Functions', 'How many onto functions are there from $\\{1, 2, 3\\}$ to $\\{a, b\\}$?', '6', ['8', '9', '2'],
  'There are $2^3 = 8$ functions; the 2 that send everything to one letter are not onto. $8 - 2 = 6$.',
  lambda: str(count(f for f in itertools.product('ab', repeat=3) if set(f) == {'a', 'b'})))

# ---------------------------------------------------------------- check and write
bad = 0
per_class = {}
for item in Q:
    per_class[item['cls']] = per_class.get(item['cls'], 0) + 1
    opts = [item['correct']] + item['wrong']
    if len(set(opts)) != 4:
        print('DUPLICATE OPTION', item['text']); bad += 1
    if any(ord(ch) < 32 for field in [item['text'], item['solution'], *opts] for ch in field):
        print('CONTROL CHARACTER (a lost backslash?)', item['text'][:60]); bad += 1
    if item['check'] is not None:
        got = item['check']()
        if got != item['correct']:
            print(f"CHECK FAILED (class {item['cls']}): {item['text'][:70]}\n   stated {item['correct']!r}, computed {got!r}"); bad += 1
unchecked = [i['text'][:60] for i in Q if i['check'] is None]
print('per class:', per_class, '| unchecked by code:', unchecked)
if bad or any(v != 10 for v in per_class.values()) or len(per_class) != 10:
    sys.exit(f'{bad} problem(s); nothing written')

rng = random.Random('amit-daily-quiz-pool-1')
import os
out_dir = sys.argv[1]
os.makedirs(out_dir, exist_ok=True)
header = ['Question', 'Type', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer', 'Solution',
          'Class', 'Difficulty', 'Marks', 'Negative Marks', 'Topic', 'Tags']
files = {}
for item in Q:
    opts = [item['correct']] + item['wrong']
    rng.shuffle(opts)
    letter = 'ABCD'[opts.index(item['correct'])]
    files.setdefault(item['cls'], []).append([item['text'], 'single_choice', *opts, letter, item['solution'],
                f"Class {item['cls']}", 'Hard', 4, 1, item['topic'], 'daily quiz, olympiad, batch 1'])
for cls, rows in sorted(files.items()):
    path = os.path.join(out_dir, f'daily-quiz-pool-class-{cls:02d}.csv')
    with open(path, 'w', newline='', encoding='utf-8-sig') as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)
print('wrote', len(Q), 'questions in', len(files), 'files to', out_dir)
