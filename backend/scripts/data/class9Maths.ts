import { mc, num, r, sc, tf, type SeedSubject } from './seedTypes';

/**
 * Class 9 Mathematics — 73 questions across the twelve CBSE chapters.
 *
 * Authored to the same standard as `class12Maths.ts`, and for the same reason: every
 * answer here is a real result that can be checked by hand, and every question carries
 * a worked solution, because the bank refuses to publish anything it cannot explain to
 * a student.
 *
 * Two Class 9 specifics worth knowing before adding to this file:
 *
 * **Coordinate geometry stops at the plane.** The distance and section formulae are
 * Class 10 in this syllabus, so the questions here are about quadrants, axes and
 * plotting. A distance-formula question would be filed under a class that has not been
 * taught it, and the daily challenge serves it to a whole cohort.
 *
 * **Where π appears, the question states which value to use.** `22/7` and `3.14` give
 * different answers to two decimal places, and a numeric question is marked against a
 * stored number — so a paper that leaves it open marks an honest answer wrong. Numeric
 * answers that are not exact carry an explicit tolerance.
 *
 * Difficulty is used honestly: `Easy` for a definition or a one-step application,
 * `Medium` for something needing a method, `Hard` for multi-step work. It drives the
 * Practice Zone's difficulty filter, so labelling everything `Medium` would make that
 * filter useless.
 */
export const CLASS9_MATHS: SeedSubject = {
  subject: 'Mathematics',
  topics: [
    // -----------------------------------------------------------------------
    {
      topic: 'Number Systems',
      questions: [
        sc(
          r`Which of the following numbers is irrational?`,
          r`$\sqrt{3}$`,
          [r`$\sqrt{16}$`, r`$0.\overline{7}$`, r`$\dfrac{22}{7}$`],
          r`$\sqrt{16}=4$ is an integer, $0.\overline{7}=\frac{7}{9}$ is a recurring decimal and $\frac{22}{7}$ is a ratio of integers — all three are rational. $3$ is not a perfect square, so $\sqrt{3}$ cannot be written as $\frac{p}{q}$ and is irrational.`,
          { d: 'Easy', tags: ['number systems', 'irrational'] },
        ),
        num(
          r`If $x = 2 + \sqrt{3}$, find the value of $x + \dfrac{1}{x}$.`,
          4,
          r`Rationalise: $\dfrac{1}{2+\sqrt{3}} = \dfrac{2-\sqrt{3}}{(2+\sqrt{3})(2-\sqrt{3})} = \dfrac{2-\sqrt{3}}{4-3} = 2-\sqrt{3}$. So $x + \frac{1}{x} = (2+\sqrt{3}) + (2-\sqrt{3}) = 4$.`,
          { d: 'Medium', tags: ['number systems', 'rationalisation'] },
        ),
        sc(
          r`On rationalising the denominator, $\dfrac{1}{\sqrt{7}-\sqrt{3}}$ equals`,
          r`$\dfrac{\sqrt{7}+\sqrt{3}}{4}$`,
          [r`$\dfrac{\sqrt{7}-\sqrt{3}}{4}$`, r`$\dfrac{\sqrt{7}+\sqrt{3}}{10}$`, r`$\sqrt{7}+\sqrt{3}$`],
          r`Multiply above and below by the conjugate $\sqrt{7}+\sqrt{3}$. The denominator becomes $(\sqrt{7})^2-(\sqrt{3})^2 = 7-3 = 4$, giving $\dfrac{\sqrt{7}+\sqrt{3}}{4}$.`,
          { d: 'Medium', tags: ['number systems', 'rationalisation'] },
        ),
        num(
          r`Write $0.\overline{36}$ as a fraction $\dfrac{p}{q}$ in its lowest terms. What is $p + q$?`,
          15,
          r`Let $x = 0.\overline{36}$. Then $100x = 36.\overline{36}$, so $99x = 36$ and $x = \frac{36}{99} = \frac{4}{11}$. Here $p = 4$ and $q = 11$, so $p+q = 15$.`,
          { d: 'Medium', tags: ['number systems', 'recurring decimal'] },
        ),
        num(
          r`Evaluate $\left(\dfrac{1}{27}\right)^{-2/3}$.`,
          9,
          r`$\frac{1}{27} = 3^{-3}$, so $\left(3^{-3}\right)^{-2/3} = 3^{2} = 9$.`,
          { d: 'Hard', tags: ['number systems', 'exponents'] },
        ),
        mc(
          r`Which of the following numbers are irrational?`,
          [r`$\pi$`, r`$\sqrt{5}$`],
          [r`$\dfrac{22}{7}$`, r`$0.25$`],
          r`$\pi$ is irrational — $\frac{22}{7}$ is only a rational approximation of it, and is itself rational. $\sqrt{5}$ is irrational because $5$ is not a perfect square. $0.25 = \frac{1}{4}$ terminates, so it is rational.`,
          { d: 'Medium', tags: ['number systems', 'irrational'] },
        ),
        tf(
          r`Every real number is either rational or irrational.`,
          true,
          r`True. The real numbers are defined as the union of the rationals and the irrationals, and the two sets have nothing in common — so every real number lies in exactly one of them.`,
          { d: 'Easy', tags: ['number systems'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Polynomials',
      questions: [
        num(
          r`Find the remainder when $4x^3 - 3x^2 + 2x - 4$ is divided by $x + 2$.`,
          -52,
          r`By the Remainder Theorem the remainder is $p(-2)$, since $x+2 = x-(-2)$. So $p(-2) = 4(-8) - 3(4) + 2(-2) - 4 = -32 - 12 - 4 - 4 = -52$.`,
          { d: 'Medium', tags: ['polynomials', 'remainder theorem'] },
        ),
        sc(
          r`If $x + y + z = 0$, then $x^3 + y^3 + z^3$ equals`,
          r`$3xyz$`,
          [r`$0$`, r`$xyz$`, r`$-3xyz$`],
          r`The identity $x^3+y^3+z^3-3xyz = (x+y+z)(x^2+y^2+z^2-xy-yz-zx)$ makes the right-hand side $0$ when $x+y+z=0$. Hence $x^3+y^3+z^3 = 3xyz$.`,
          { d: 'Medium', tags: ['polynomials', 'identities'] },
        ),
        num(
          r`Find the value of $k$ for which $x - 1$ is a factor of $x^3 - 3x^2 + kx - 1$.`,
          3,
          r`By the Factor Theorem, $x-1$ is a factor exactly when $p(1)=0$. Here $p(1) = 1 - 3 + k - 1 = k - 3$, so $k = 3$.`,
          { d: 'Medium', tags: ['polynomials', 'factor theorem'] },
        ),
        num(
          r`Using a suitable identity, evaluate $(103)^2$.`,
          10609,
          r`$(100+3)^2 = 100^2 + 2\times100\times3 + 3^2 = 10000 + 600 + 9 = 10609$.`,
          { d: 'Easy', tags: ['polynomials', 'identities'] },
        ),
        sc(
          r`The degree of the polynomial $(x^2+1)(x^3-2x)$ is`,
          r`$5$`,
          [r`$3$`, r`$4$`, r`$6$`],
          r`The degree of a product is the sum of the degrees: $2 + 3 = 5$. Expanding gives $x^5 - x^3 - 2x$, whose highest power is indeed $5$.`,
          { d: 'Easy', tags: ['polynomials', 'degree'] },
        ),
        num(
          r`If $x + \dfrac{1}{x} = 5$, find the value of $x^2 + \dfrac{1}{x^2}$.`,
          23,
          r`Square both sides: $\left(x+\frac{1}{x}\right)^2 = x^2 + 2 + \frac{1}{x^2} = 25$. Therefore $x^2 + \frac{1}{x^2} = 25 - 2 = 23$.`,
          { d: 'Hard', tags: ['polynomials', 'identities'] },
        ),
        tf(
          r`$\sqrt{x} + 1$ is a polynomial in $x$.`,
          false,
          r`False. In a polynomial every power of the variable must be a non-negative integer, and $\sqrt{x} = x^{1/2}$ is not. So $\sqrt{x}+1$ is an algebraic expression but not a polynomial.`,
          { d: 'Easy', tags: ['polynomials'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Coordinate Geometry',
      questions: [
        sc(
          r`The point $(-3, 5)$ lies in which quadrant?`,
          r`Second quadrant`,
          [r`First quadrant`, r`Third quadrant`, r`Fourth quadrant`],
          r`The abscissa is negative and the ordinate is positive. That is the sign pattern $(-,+)$, which is the second quadrant.`,
          { d: 'Easy', tags: ['coordinate geometry', 'quadrants'] },
        ),
        sc(
          r`Every point lying on the $x$-axis has`,
          r`ordinate $0$`,
          [r`abscissa $0$`, r`both coordinates $0$`, r`abscissa equal to its ordinate`],
          r`A point on the $x$-axis is at no height above or below it, so its $y$-coordinate — the ordinate — is $0$. Its $x$-coordinate can be anything. (A point with abscissa $0$ lies on the $y$-axis instead.)`,
          { d: 'Easy', tags: ['coordinate geometry', 'axes'] },
        ),
        num(
          r`What is the perpendicular distance of the point $(0, -7)$ from the $x$-axis?`,
          7,
          r`The distance of a point from the $x$-axis is the absolute value of its ordinate: $|-7| = 7$ units. The point lies $7$ units below the axis.`,
          { d: 'Easy', tags: ['coordinate geometry', 'distance from axis'] },
        ),
        num(
          r`What is the perpendicular distance of the point $(-4, 3)$ from the $y$-axis?`,
          4,
          r`The distance of a point from the $y$-axis is the absolute value of its abscissa: $|-4| = 4$ units.`,
          { d: 'Easy', tags: ['coordinate geometry', 'distance from axis'] },
        ),
        sc(
          r`In which quadrant does a point $(x, y)$ lie when $x > 0$ and $y < 0$?`,
          r`Fourth quadrant`,
          [r`First quadrant`, r`Second quadrant`, r`Third quadrant`],
          r`Reading anticlockwise from the positive $x$-axis the sign patterns are $(+,+)$, $(-,+)$, $(-,-)$ and $(+,-)$. So $(+,-)$ is the fourth quadrant.`,
          { d: 'Easy', tags: ['coordinate geometry', 'quadrants'] },
        ),
        tf(
          r`The points $(2, 3)$ and $(3, 2)$ are the same point of the plane.`,
          false,
          r`False. A coordinate pair is ordered: the first entry is measured along the $x$-axis and the second along the $y$-axis. $(2,3)$ and $(3,2)$ are two different points, reflections of each other in the line $y=x$.`,
          { d: 'Easy', tags: ['coordinate geometry'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Linear Equations in Two Variables',
      questions: [
        num(
          r`If $x = 2$, $y = 1$ is a solution of $2x + 3y = k$, find $k$.`,
          7,
          r`Substitute the solution into the equation: $k = 2(2) + 3(1) = 4 + 3 = 7$.`,
          { d: 'Easy', tags: ['linear equations', 'solutions'] },
        ),
        sc(
          r`The graph of the equation $x = 5$ in the Cartesian plane is`,
          r`a line parallel to the $y$-axis`,
          [r`a line parallel to the $x$-axis`, r`a single point on the $x$-axis`, r`a line through the origin`],
          r`Every point whose abscissa is $5$ satisfies it, whatever its ordinate: $(5,0)$, $(5,1)$, $(5,-2)$ and so on. Those points form a vertical line $5$ units to the right of the $y$-axis, so it is parallel to the $y$-axis.`,
          { d: 'Medium', tags: ['linear equations', 'graphs'] },
        ),
        sc(
          r`How many solutions does a linear equation in two variables have?`,
          r`Infinitely many`,
          [r`Exactly one`, r`Exactly two`, r`None`],
          r`Choosing any value for one variable determines the other, and there are infinitely many values to choose. Geometrically the solutions are the points of a straight line, of which there are infinitely many.`,
          { d: 'Easy', tags: ['linear equations'] },
        ),
        num(
          r`In the equation $3x + 4y = 12$, find the value of $y$ when $x = 0$.`,
          3,
          r`Putting $x=0$ gives $4y = 12$, so $y = 3$. The line therefore cuts the $y$-axis at $(0,3)$.`,
          { d: 'Easy', tags: ['linear equations', 'intercepts'] },
        ),
        num(
          r`The cost of a notebook is twice the cost of a pen. Taking the pen's cost as $x$ rupees and the notebook's as $y$ rupees, this is written $y = 2x$. If a pen costs $7$ rupees, what does the notebook cost, in rupees?`,
          14,
          r`Substituting $x = 7$ into $y = 2x$ gives $y = 14$. The notebook costs $14$ rupees.`,
          { d: 'Easy', tags: ['linear equations', 'word problem'] },
        ),
        tf(
          r`Every point on the line $y = x$ has its two coordinates equal.`,
          true,
          r`True. A point $(a,b)$ lies on the line exactly when $b = a$, so the ordinate equals the abscissa — for example $(0,0)$, $(1,1)$ and $(-3,-3)$.`,
          { d: 'Easy', tags: ['linear equations', 'graphs'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Lines and Angles',
      questions: [
        num(
          r`Two supplementary angles are in the ratio $2:3$. Find the smaller angle, in degrees.`,
          72,
          r`Supplementary angles add to $180^\circ$. Writing them as $2k$ and $3k$ gives $5k = 180$, so $k = 36$ and the angles are $72^\circ$ and $108^\circ$. The smaller is $72^\circ$.`,
          { d: 'Medium', tags: ['lines and angles', 'supplementary'] },
        ),
        sc(
          r`If two straight lines intersect, then the vertically opposite angles are`,
          r`equal`,
          [r`supplementary`, r`complementary`, r`unrelated`],
          r`Each of the two angles is supplementary to the same adjacent angle, so both equal $180^\circ$ minus that angle — hence they are equal. This is the vertically opposite angles theorem.`,
          { d: 'Easy', tags: ['lines and angles', 'vertically opposite'] },
        ),
        num(
          r`The angles of a triangle are in the ratio $1:2:3$. What is the largest angle, in degrees?`,
          90,
          r`The angle sum is $180^\circ$, so $k + 2k + 3k = 180$ gives $k = 30$. The angles are $30^\circ$, $60^\circ$ and $90^\circ$, so the largest is $90^\circ$ — the triangle is right-angled.`,
          { d: 'Medium', tags: ['lines and angles', 'angle sum'] },
        ),
        num(
          r`An exterior angle of a triangle is $110^\circ$ and one of the interior opposite angles is $45^\circ$. Find the other interior opposite angle, in degrees.`,
          65,
          r`By the exterior angle theorem an exterior angle equals the sum of the two interior opposite angles: $110 = 45 + x$, so $x = 65^\circ$.`,
          { d: 'Medium', tags: ['lines and angles', 'exterior angle'] },
        ),
        sc(
          r`When a transversal cuts two parallel lines, a pair of co-interior (allied) angles is`,
          r`supplementary`,
          [r`equal`, r`complementary`, r`in the ratio $1:2$`],
          r`Co-interior angles lie on the same side of the transversal between the two parallel lines, and they add to $180^\circ$. It is the alternate and corresponding pairs that are equal.`,
          { d: 'Medium', tags: ['lines and angles', 'parallel lines'] },
        ),
        tf(
          r`Two obtuse angles can be supplementary.`,
          false,
          r`False. An obtuse angle is greater than $90^\circ$, so two of them add to more than $180^\circ$ and cannot be supplementary. A supplementary pair is either two right angles, or one acute and one obtuse.`,
          { d: 'Medium', tags: ['lines and angles', 'supplementary'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Triangles',
      questions: [
        sc(
          r`Two triangles have two sides and the angle *between* those sides equal. Which congruence criterion applies?`,
          r`SAS`,
          [r`SSA`, r`AAA`, r`RHS`],
          r`Two sides and the included angle equal is exactly the SAS criterion. Note it is the *included* angle that matters — the same data with a non-included angle (SSA) does not fix the triangle.`,
          { d: 'Easy', tags: ['triangles', 'congruence'] },
        ),
        num(
          r`In $\triangle ABC$, $AB = AC$ and $\angle B = 50^\circ$. Find $\angle A$, in degrees.`,
          80,
          r`Angles opposite equal sides are equal, so $\angle C = \angle B = 50^\circ$. The angle sum gives $\angle A = 180 - 50 - 50 = 80^\circ$.`,
          { d: 'Medium', tags: ['triangles', 'isosceles'] },
        ),
        num(
          r`The vertex angle of an isosceles triangle is $40^\circ$. Find each base angle, in degrees.`,
          70,
          r`The two base angles are equal, say $x$ each. Then $40 + 2x = 180$, so $x = 70^\circ$.`,
          { d: 'Easy', tags: ['triangles', 'isosceles'] },
        ),
        sc(
          r`In a triangle, the side opposite the greater angle is`,
          r`longer than the side opposite the smaller angle`,
          [
            r`shorter than the side opposite the smaller angle`,
            r`equal to the side opposite the smaller angle`,
            r`always the shortest side`,
          ],
          r`In any triangle the longer side lies opposite the greater angle, and conversely. So the side facing the greater angle is the longer of the two.`,
          { d: 'Medium', tags: ['triangles', 'inequalities'] },
        ),
        tf(
          r`SSA (two sides and a non-included angle) is a valid criterion for congruence of triangles.`,
          false,
          r`False. Two sides and a non-included angle can describe two genuinely different triangles — the classic ambiguous case — so it does not prove congruence. The valid criteria are SSS, SAS, ASA, AAS and RHS.`,
          { d: 'Medium', tags: ['triangles', 'congruence'] },
        ),
        sc(
          r`Which set of lengths can be the three sides of a triangle?`,
          r`$5$ cm, $6$ cm, $10$ cm`,
          [r`$2$ cm, $3$ cm, $6$ cm`, r`$4$ cm, $4$ cm, $9$ cm`, r`$1$ cm, $2$ cm, $3$ cm`],
          r`The sum of any two sides must be strictly greater than the third. Here $5+6=11 > 10$, and the other two checks pass as well. The rejected sets fail it: $2+3=5 < 6$, $4+4=8 < 9$, and $1+2=3$ is equal to the third side, which gives a straight line rather than a triangle.`,
          { d: 'Hard', tags: ['triangles', 'triangle inequality'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Quadrilaterals',
      questions: [
        num(
          r`The angles of a quadrilateral are in the ratio $1:2:3:4$. Find the largest angle, in degrees.`,
          144,
          r`The angles of a quadrilateral add to $360^\circ$, so $k+2k+3k+4k = 360$ gives $10k = 360$ and $k = 36$. The angles are $36^\circ$, $72^\circ$, $108^\circ$ and $144^\circ$.`,
          { d: 'Medium', tags: ['quadrilaterals', 'angle sum'] },
        ),
        sc(
          r`The diagonals of a rhombus`,
          r`bisect each other at right angles`,
          [r`are equal in length`, r`do not intersect`, r`bisect each other but never at right angles`],
          r`A rhombus is a parallelogram, so its diagonals bisect each other; because all four sides are equal they also meet at $90^\circ$. Equal diagonals are the property of a rectangle, not a rhombus.`,
          { d: 'Medium', tags: ['quadrilaterals', 'rhombus'] },
        ),
        num(
          r`In parallelogram $ABCD$, $\angle A = 65^\circ$. Find $\angle B$, in degrees.`,
          115,
          r`Consecutive angles of a parallelogram are supplementary because $AD \parallel BC$ and $AB$ is a transversal. So $\angle B = 180 - 65 = 115^\circ$.`,
          { d: 'Medium', tags: ['quadrilaterals', 'parallelogram'] },
        ),
        sc(
          r`A quadrilateral whose diagonals bisect each other must be a`,
          r`parallelogram`,
          [r`trapezium`, r`kite`, r`rectangle`],
          r`If the diagonals bisect each other, the two triangles on either side of a diagonal are congruent by SAS, which forces both pairs of opposite sides to be equal and parallel — a parallelogram. A rectangle also needs equal diagonals, which is more than is given.`,
          { d: 'Medium', tags: ['quadrilaterals', 'parallelogram'] },
        ),
        mc(
          r`In which of the following quadrilaterals are all four sides equal in length?`,
          [r`Square`, r`Rhombus`],
          [r`Rectangle`, r`Parallelogram`],
          r`A square and a rhombus are defined by having four equal sides. A rectangle and a general parallelogram have only their *opposite* sides equal — a rectangle with four equal sides is a square.`,
          { d: 'Easy', tags: ['quadrilaterals'] },
        ),
        tf(
          r`The line segment joining the mid-points of two sides of a triangle is parallel to the third side and half its length.`,
          true,
          r`True — this is the Mid-point Theorem, and its converse (a line through one mid-point parallel to another side bisects the third) is equally standard.`,
          { d: 'Medium', tags: ['quadrilaterals', 'midpoint theorem'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Circles',
      questions: [
        sc(
          r`Equal chords of a circle subtend`,
          r`equal angles at the centre`,
          [r`supplementary angles at the centre`, r`a right angle at the centre`, r`angles in the ratio of their lengths`],
          r`Join each chord's endpoints to the centre. The two triangles formed have three pairs of equal sides (two radii and the equal chords), so they are congruent by SSS and the angles at the centre are equal.`,
          { d: 'Easy', tags: ['circles', 'chords'] },
        ),
        num(
          r`What is the measure, in degrees, of an angle in a semicircle?`,
          90,
          r`The diameter subtends a straight angle of $180^\circ$ at the centre, and the angle at the circumference is half the angle at the centre — so it is $90^\circ$. Every angle in a semicircle is a right angle.`,
          { d: 'Easy', tags: ['circles', 'angle in semicircle'] },
        ),
        num(
          r`An arc of a circle subtends an angle of $80^\circ$ at the centre. What angle, in degrees, does it subtend at a point on the remaining part of the circle?`,
          40,
          r`The angle at the centre is twice the angle subtended at any point on the remaining part of the circle, so the angle there is $80 \div 2 = 40^\circ$.`,
          { d: 'Medium', tags: ['circles', 'angle at centre'] },
        ),
        num(
          r`$ABCD$ is a cyclic quadrilateral with $\angle A = 100^\circ$. Find $\angle C$, in degrees.`,
          80,
          r`Opposite angles of a cyclic quadrilateral are supplementary, so $\angle C = 180 - 100 = 80^\circ$.`,
          { d: 'Medium', tags: ['circles', 'cyclic quadrilateral'] },
        ),
        num(
          r`A chord of length $8$ cm lies in a circle of radius $5$ cm. Find its distance from the centre, in cm.`,
          3,
          r`The perpendicular from the centre bisects the chord, giving a right triangle with hypotenuse $5$ cm and one leg $4$ cm. So the distance is $\sqrt{5^2-4^2} = \sqrt{9} = 3$ cm.`,
          { d: 'Hard', tags: ['circles', 'chords'] },
        ),
        tf(
          r`The perpendicular drawn from the centre of a circle to a chord bisects the chord.`,
          true,
          r`True. The two triangles formed share the perpendicular, have equal hypotenuses (radii) and a right angle each, so they are congruent by RHS — making the two halves of the chord equal.`,
          { d: 'Easy', tags: ['circles', 'chords'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: "Heron's Formula",
      questions: [
        num(
          r`Find the area, in square centimetres, of a triangle whose sides are $3$ cm, $4$ cm and $5$ cm.`,
          6,
          r`$s = \frac{3+4+5}{2} = 6$, so the area is $\sqrt{6(6-3)(6-4)(6-5)} = \sqrt{6\times3\times2\times1} = \sqrt{36} = 6$ cm². (It is a right triangle, and $\frac{1}{2}\times3\times4$ agrees.)`,
          { d: 'Easy', tags: ["heron's formula"] },
        ),
        num(
          r`Find the area, in square centimetres, of a triangle whose sides are $13$ cm, $14$ cm and $15$ cm.`,
          84,
          r`$s = \frac{13+14+15}{2} = 21$. Then the area is $\sqrt{21(21-13)(21-14)(21-15)} = \sqrt{21\times8\times7\times6} = \sqrt{7056} = 84$ cm².`,
          { d: 'Medium', tags: ["heron's formula"] },
        ),
        num(
          r`Find the area of an equilateral triangle of side $6$ cm, in square centimetres, correct to two decimal places.`,
          15.59,
          r`For an equilateral triangle the area is $\frac{\sqrt{3}}{4}a^2 = \frac{\sqrt{3}}{4}\times36 = 9\sqrt{3} \approx 15.59$ cm².`,
          { d: 'Medium', tags: ["heron's formula", 'equilateral'], tol: 0.02 },
        ),
        sc(
          r`Heron's formula gives the area of a triangle with sides $a$, $b$, $c$ and semi-perimeter $s$ as`,
          r`$\sqrt{s(s-a)(s-b)(s-c)}$`,
          [r`$s(s-a)(s-b)(s-c)$`, r`$\sqrt{s(a-s)(b-s)(c-s)}$`, r`$\dfrac{1}{2}\sqrt{s(s-a)(s-b)(s-c)}$`],
          r`Heron's formula is $\text{Area} = \sqrt{s(s-a)(s-b)(s-c)}$ where $s = \frac{a+b+c}{2}$. The square root matters: without it the expression has the wrong dimensions.`,
          { d: 'Easy', tags: ["heron's formula"] },
        ),
        num(
          r`A triangular park has sides $5$ m, $12$ m and $13$ m. Find its area in square metres.`,
          30,
          r`$s = \frac{5+12+13}{2} = 15$, so the area is $\sqrt{15\times10\times3\times2} = \sqrt{900} = 30$ m². ($5$–$12$–$13$ is a right triangle, and $\frac{1}{2}\times5\times12$ agrees.)`,
          { d: 'Medium', tags: ["heron's formula", 'word problem'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Surface Areas and Volumes',
      questions: [
        num(
          r`Find the volume, in cubic centimetres, of a cube of edge $7$ cm.`,
          343,
          r`The volume of a cube is $a^3 = 7^3 = 343$ cm³.`,
          { d: 'Easy', tags: ['mensuration', 'cube'] },
        ),
        num(
          r`Find the curved surface area of a cylinder of radius $7$ cm and height $10$ cm, in square centimetres. Take $\pi = \dfrac{22}{7}$.`,
          440,
          r`Curved surface area $= 2\pi r h = 2 \times \frac{22}{7} \times 7 \times 10 = 440$ cm².`,
          { d: 'Medium', tags: ['mensuration', 'cylinder'] },
        ),
        num(
          r`Find the surface area of a sphere of radius $7$ cm, in square centimetres. Take $\pi = \dfrac{22}{7}$.`,
          616,
          r`Surface area $= 4\pi r^2 = 4 \times \frac{22}{7} \times 49 = 616$ cm².`,
          { d: 'Medium', tags: ['mensuration', 'sphere'] },
        ),
        num(
          r`Find the volume of a cone of radius $3$ cm and height $4$ cm, in cubic centimetres, correct to two decimal places. Take $\pi = 3.14$.`,
          37.68,
          r`Volume $= \frac{1}{3}\pi r^2 h = \frac{1}{3} \times 3.14 \times 9 \times 4 = 37.68$ cm³.`,
          { d: 'Medium', tags: ['mensuration', 'cone'], tol: 0.02 },
        ),
        sc(
          r`The total surface area of a solid hemisphere of radius $r$ is`,
          r`$3\pi r^2$`,
          [r`$2\pi r^2$`, r`$4\pi r^2$`, r`$\dfrac{2}{3}\pi r^3$`],
          r`The curved part contributes $2\pi r^2$ and the flat circular face contributes $\pi r^2$, giving $3\pi r^2$ in total. $2\pi r^2$ is the curved surface area alone.`,
          { d: 'Medium', tags: ['mensuration', 'hemisphere'] },
        ),
        num(
          r`The slant height of a cone is $13$ cm and its base radius is $5$ cm. Find its height, in centimetres.`,
          12,
          r`The radius, height and slant height form a right triangle: $h = \sqrt{l^2 - r^2} = \sqrt{169-25} = \sqrt{144} = 12$ cm.`,
          { d: 'Hard', tags: ['mensuration', 'cone'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Statistics',
      questions: [
        num(
          r`Find the mean of $2$, $4$, $6$, $8$ and $10$.`,
          6,
          r`The mean is $\frac{2+4+6+8+10}{5} = \frac{30}{5} = 6$.`,
          { d: 'Easy', tags: ['statistics', 'mean'] },
        ),
        num(
          r`Find the median of $3$, $5$, $9$, $11$, $13$, $15$.`,
          10,
          r`There are six observations, already in order, so the median is the mean of the third and fourth: $\frac{9+11}{2} = 10$.`,
          { d: 'Medium', tags: ['statistics', 'median'] },
        ),
        num(
          r`Find the mode of $2$, $3$, $3$, $4$, $5$, $3$, $6$.`,
          3,
          r`The mode is the most frequent observation. Here $3$ occurs three times and every other value once, so the mode is $3$.`,
          { d: 'Easy', tags: ['statistics', 'mode'] },
        ),
        num(
          r`Find the range of the data $12$, $7$, $20$, $3$, $15$.`,
          17,
          r`The range is the largest observation minus the smallest: $20 - 3 = 17$.`,
          { d: 'Easy', tags: ['statistics', 'range'] },
        ),
        num(
          r`What is the class mark of the interval $10$–$25$?`,
          17.5,
          r`The class mark is the mean of the two limits: $\frac{10+25}{2} = 17.5$.`,
          { d: 'Easy', tags: ['statistics', 'class mark'] },
        ),
        num(
          r`The mean of five numbers is $18$. Four of them are $10$, $15$, $20$ and $25$. Find the fifth number.`,
          20,
          r`The five numbers total $5 \times 18 = 90$. The four given add to $70$, so the fifth is $90 - 70 = 20$.`,
          { d: 'Medium', tags: ['statistics', 'mean'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Probability',
      questions: [
        num(
          r`A coin is tossed $100$ times and a head appears $56$ times. Find the empirical probability of getting a tail. Give the answer as a decimal.`,
          0.44,
          r`A tail appeared $100 - 56 = 44$ times, so the empirical probability is $\frac{44}{100} = 0.44$.`,
          { d: 'Medium', tags: ['probability', 'empirical'], tol: 0.001 },
        ),
        sc(
          r`The probability of an impossible event is`,
          r`$0$`,
          [r`$1$`, r`$\dfrac{1}{2}$`, r`between $0$ and $1$`],
          r`An impossible event never occurs, so it happens in $0$ of the trials and its probability is $0$. A certain event has probability $1$, and every probability lies between the two.`,
          { d: 'Easy', tags: ['probability'] },
        ),
        num(
          r`A die is thrown once. What is the probability of getting an even number? Give the answer as a decimal.`,
          0.5,
          r`The even outcomes are $2$, $4$ and $6$ — three of the six equally likely faces — so the probability is $\frac{3}{6} = 0.5$.`,
          { d: 'Easy', tags: ['probability', 'dice'], tol: 0.001 },
        ),
        num(
          r`In $200$ trials of an experiment an event occurred $50$ times. Find its empirical probability, as a decimal.`,
          0.25,
          r`The empirical probability is the number of times the event occurred divided by the number of trials: $\frac{50}{200} = 0.25$.`,
          { d: 'Easy', tags: ['probability', 'empirical'], tol: 0.001 },
        ),
        num(
          r`A bag holds $3$ red and $2$ green balls. One ball is drawn at random. What is the probability that it is red? Give the answer correct to two decimal places.`,
          0.6,
          r`There are $5$ equally likely balls, of which $3$ are red, so the probability is $\frac{3}{5} = 0.6$.`,
          { d: 'Medium', tags: ['probability'], tol: 0.005 },
        ),
        tf(
          r`The probability of an event can be $1.2$.`,
          false,
          r`False. A probability is a number between $0$ and $1$ inclusive, because the count of favourable outcomes can never exceed the total number of trials or outcomes. A value of $1.2$ signals an arithmetic error.`,
          { d: 'Easy', tags: ['probability'] },
        ),
      ],
    },
  ],
};
