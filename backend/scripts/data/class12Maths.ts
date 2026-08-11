import { mc, num, r, sc, tf, type SeedSubject } from './seedTypes';

/**
 * Class 12 Mathematics — 104 questions across the thirteen CBSE chapters.
 *
 * Every answer here is a real result, not a plausible-looking one: the numeric
 * answers are values that can be checked by hand, and each question carries a worked
 * solution because the question bank refuses to publish anything unexplainable.
 *
 * Difficulty is used honestly — `Easy` for a definition or a one-step application,
 * `Medium` for something needing a method, `Hard` for multi-step work. It drives the
 * Practice Zone's difficulty filter, so labelling everything `Medium` would make that
 * filter useless.
 */
export const CLASS12_MATHS: SeedSubject = {
  subject: 'Mathematics',
  topics: [
    // -----------------------------------------------------------------------
    {
      topic: 'Relations and Functions',
      questions: [
        sc(
          r`Let $f:\mathbb{R}\to\mathbb{R}$ be given by $f(x)=3x+2$. Which statement is correct?`,
          r`$f$ is both one-one and onto`,
          [r`$f$ is one-one but not onto`, r`$f$ is onto but not one-one`, r`$f$ is neither one-one nor onto`],
          r`If $f(a)=f(b)$ then $3a+2=3b+2$, so $a=b$ and $f$ is one-one. For any $y\in\mathbb{R}$, $x=(y-2)/3$ gives $f(x)=y$, so $f$ is onto. Hence $f$ is a bijection.`,
          { d: 'Easy', tags: ['functions', 'bijection'] },
        ),
        num(
          r`How many one-one functions are there from a set with $3$ elements to a set with $4$ elements?`,
          24,
          r`Each of the $3$ inputs must go to a distinct output, so the count is $^4P_3 = 4\times3\times2 = 24$.`,
          { d: 'Medium', tags: ['functions', 'counting'] },
        ),
        sc(
          r`If $f(x)=x^2$ with domain $\mathbb{R}$, then $f$ is`,
          r`neither one-one nor onto`,
          [r`one-one and onto`, r`one-one but not onto`, r`onto but not one-one`],
          r`$f(-2)=f(2)=4$, so $f$ is not one-one. No $x$ gives $f(x)=-1$, so the range is $[0,\infty)$ and $f$ is not onto $\mathbb{R}$.`,
          { d: 'Easy', tags: ['functions'] },
        ),
        tf(
          r`The relation $R=\{(1,1),(2,2),(3,3)\}$ on the set $\{1,2,3\}$ is an equivalence relation.`,
          true,
          r`It is reflexive (every element relates to itself), symmetric (there is no pair $(a,b)$ with $a\neq b$ to violate it) and transitive for the same reason. So it is an equivalence relation — the identity relation always is.`,
          { d: 'Easy', tags: ['relations', 'equivalence'] },
        ),
        sc(
          r`If $f(x)=\dfrac{2x+1}{3}$, then $f^{-1}(x)$ equals`,
          r`$\dfrac{3x-1}{2}$`,
          [r`$\dfrac{3x+1}{2}$`, r`$\dfrac{2x-1}{3}$`, r`$\dfrac{x-1}{6}$`],
          r`Put $y=(2x+1)/3$. Then $3y=2x+1$, so $x=(3y-1)/2$. Swapping names, $f^{-1}(x)=(3x-1)/2$.`,
          { d: 'Medium', tags: ['functions', 'inverse'] },
        ),
        sc(
          r`If $f(x)=x+1$ and $g(x)=x^2$, then $(g\circ f)(x)$ equals`,
          r`$(x+1)^2$`,
          [r`$x^2+1$`, r`$x^2+x$`, r`$2x+1$`],
          r`$(g\circ f)(x)=g(f(x))=g(x+1)=(x+1)^2$. Note this differs from $(f\circ g)(x)=x^2+1$ — composition is not commutative.`,
          { d: 'Medium', tags: ['functions', 'composition'] },
        ),
        tf(
          r`Every function that is onto must also be one-one.`,
          false,
          r`False. Take $f:\mathbb{R}\to\mathbb{R}$, $f(x)=x^3-x$. It is onto but $f(0)=f(1)=f(-1)=0$, so it is not one-one. The two properties are independent.`,
          { d: 'Medium', tags: ['functions'] },
        ),
        num(
          r`A relation on $\{1,2,3\}$ is defined by $R=\{(a,b): a<b\}$. How many ordered pairs does $R$ contain?`,
          3,
          r`The pairs with $a<b$ are $(1,2)$, $(1,3)$ and $(2,3)$ — three in total.`,
          { d: 'Easy', tags: ['relations', 'counting'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Inverse Trigonometric Functions',
      questions: [
        sc(
          r`The principal value of $\sin^{-1}\left(\dfrac{1}{2}\right)$ is`,
          r`$\dfrac{\pi}{6}$`,
          [r`$\dfrac{\pi}{3}$`, r`$\dfrac{5\pi}{6}$`, r`$\dfrac{\pi}{4}$`],
          r`$\sin^{-1}$ has principal range $[-\pi/2,\ \pi/2]$, and $\sin(\pi/6)=1/2$, so the value is $\pi/6$.`,
          { d: 'Easy', tags: ['inverse-trig'] },
        ),
        sc(
          r`The range of the principal branch of $\cos^{-1}x$ is`,
          r`$[0,\ \pi]$`,
          [r`$\left[-\dfrac{\pi}{2},\ \dfrac{\pi}{2}\right]$`, r`$(0,\ \pi)$`, r`$[-\pi,\ \pi]$`],
          r`By convention $\cos^{-1}$ is defined with range $[0,\pi]$, on which cosine is one-one and takes every value in $[-1,1]$.`,
          { d: 'Easy', tags: ['inverse-trig', 'range'] },
        ),
        sc(
          r`$\sin^{-1}\left(\sin\dfrac{2\pi}{3}\right)$ equals`,
          r`$\dfrac{\pi}{3}$`,
          [r`$\dfrac{2\pi}{3}$`, r`$-\dfrac{\pi}{3}$`, r`$\dfrac{\pi}{6}$`],
          r`$2\pi/3$ lies outside the principal range $[-\pi/2,\pi/2]$, so the answer is not $2\pi/3$. Since $\sin(2\pi/3)=\sin(\pi/3)=\sqrt{3}/2$ and $\pi/3$ *is* in range, the value is $\pi/3$.`,
          { d: 'Hard', tags: ['inverse-trig'] },
        ),
        sc(
          r`$\cos^{-1}\left(\cos\dfrac{7\pi}{6}\right)$ equals`,
          r`$\dfrac{5\pi}{6}$`,
          [r`$\dfrac{7\pi}{6}$`, r`$\dfrac{\pi}{6}$`, r`$-\dfrac{\pi}{6}$`],
          r`$7\pi/6>\pi$, so it is outside the range $[0,\pi]$. Using $\cos(2\pi-\theta)=\cos\theta$ is not enough here; instead $\cos(7\pi/6)=-\sqrt3/2=\cos(5\pi/6)$, and $5\pi/6\in[0,\pi]$.`,
          { d: 'Hard', tags: ['inverse-trig'] },
        ),
        sc(
          r`The domain of $\sec^{-1}x$ is`,
          r`$(-\infty,-1]\cup[1,\infty)$`,
          [r`$[-1,1]$`, r`$\mathbb{R}$`, r`$(-1,1)$`],
          r`$\sec\theta=1/\cos\theta$ has absolute value at least $1$, so $\sec^{-1}x$ exists only when $|x|\ge1$.`,
          { d: 'Medium', tags: ['inverse-trig', 'domain'] },
        ),
        sc(
          r`$\tan^{-1}\dfrac{1}{2}+\tan^{-1}\dfrac{1}{3}$ equals`,
          r`$\dfrac{\pi}{4}$`,
          [r`$\dfrac{\pi}{3}$`, r`$\dfrac{\pi}{6}$`, r`$\dfrac{\pi}{2}$`],
          r`Since the product $\frac12\cdot\frac13<1$, use $\tan^{-1}x+\tan^{-1}y=\tan^{-1}\dfrac{x+y}{1-xy}=\tan^{-1}\dfrac{5/6}{5/6}=\tan^{-1}1=\dfrac{\pi}{4}$.`,
          { d: 'Medium', tags: ['inverse-trig', 'identity'] },
        ),
        tf(
          r`For every $x\in[-1,1]$, $\ \sin^{-1}x+\cos^{-1}x=\dfrac{\pi}{2}$.`,
          true,
          r`True. If $\theta=\sin^{-1}x$ then $x=\sin\theta=\cos(\pi/2-\theta)$, and $\pi/2-\theta$ lies in $[0,\pi]$, so $\cos^{-1}x=\pi/2-\theta$. Adding gives $\pi/2$.`,
          { d: 'Medium', tags: ['inverse-trig', 'identity'] },
        ),
        num(
          r`Evaluate $\tan^{-1}(1)+\tan^{-1}(2)+\tan^{-1}(3)$, giving your answer as a decimal correct to two places.`,
          3.14,
          r`$\tan^{-1}2+\tan^{-1}3=\pi+\tan^{-1}\dfrac{5}{1-6}=\pi-\dfrac{\pi}{4}=\dfrac{3\pi}{4}$ (the $\pi$ is added because $xy>1$). Adding $\tan^{-1}1=\pi/4$ gives $\pi\approx3.14$.`,
          { d: 'Hard', tol: 0.01, tags: ['inverse-trig'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Matrices',
      questions: [
        sc(
          r`If $A$ is of order $3\times4$ and $B$ is of order $4\times5$, then $AB$ has order`,
          r`$3\times5$`,
          [r`$4\times4$`, r`$5\times3$`, r`$AB$ is not defined`],
          r`For $AB$ the inner dimensions must agree — they do ($4=4$) — and the product takes the outer ones, giving $3\times5$.`,
          { d: 'Easy', tags: ['matrices', 'order'] },
        ),
        num(
          r`How many entries does a $3\times4$ matrix have?`,
          12,
          r`A matrix of order $m\times n$ has $mn$ entries, so $3\times4=12$.`,
          { d: 'Easy', tags: ['matrices'] },
        ),
        tf(
          r`For any two matrices $A$ and $B$ for which the product is defined, $(AB)^{T}=B^{T}A^{T}$.`,
          true,
          r`True — this is the reversal law for transposes. Note the order reverses; $(AB)^T=A^TB^T$ is false in general and is usually not even dimensionally valid.`,
          { d: 'Medium', tags: ['matrices', 'transpose'] },
        ),
        num(
          r`Find the trace of $A=\begin{bmatrix}2&3\\1&4\end{bmatrix}$.`,
          6,
          r`The trace is the sum of the diagonal entries: $2+4=6$.`,
          { d: 'Easy', tags: ['matrices', 'trace'] },
        ),
        tf(
          r`Every diagonal entry of a skew-symmetric matrix is zero.`,
          true,
          r`True. Skew-symmetry means $a_{ij}=-a_{ji}$. Setting $i=j$ gives $a_{ii}=-a_{ii}$, so $2a_{ii}=0$ and $a_{ii}=0$.`,
          { d: 'Medium', tags: ['matrices', 'skew-symmetric'] },
        ),
        tf(
          r`Matrix multiplication is commutative.`,
          false,
          r`False. With $A=\begin{bmatrix}1&1\\0&1\end{bmatrix}$ and $B=\begin{bmatrix}1&0\\1&1\end{bmatrix}$, $AB\neq BA$. Multiplication is associative and distributive, but not commutative.`,
          { d: 'Easy', tags: ['matrices'] },
        ),
        mc(
          r`A matrix has exactly $6$ entries. Which of the following are possible orders for it?`,
          [r`$2\times3$`, r`$6\times1$`],
          [r`$4\times2$`, r`$5\times1$`],
          r`The order $m\times n$ must satisfy $mn=6$, so the possibilities are $1\times6$, $2\times3$, $3\times2$ and $6\times1$. Of the options given, $2\times3$ and $6\times1$ qualify; $4\times2=8$ and $5\times1=5$ do not.`,
          { d: 'Medium', tags: ['matrices', 'order'] },
        ),
        sc(
          r`If $A=\begin{bmatrix}1&2\\3&4\end{bmatrix}$, then $A+A^{T}$ is`,
          r`symmetric`,
          [r`skew-symmetric`, r`the zero matrix`, r`not defined`],
          r`$(A+A^T)^T=A^T+A=A+A^T$, so the sum equals its own transpose and is symmetric. Here it is $\begin{bmatrix}2&5\\5&8\end{bmatrix}$.`,
          { d: 'Medium', tags: ['matrices', 'symmetric'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Determinants',
      questions: [
        num(
          r`Evaluate $\begin{vmatrix}2&3\\4&5\end{vmatrix}$.`,
          -2,
          r`For a $2\times2$ determinant, $ad-bc = 2\times5-3\times4 = 10-12 = -2$.`,
          { d: 'Easy', tags: ['determinants'] },
        ),
        num(
          r`Evaluate $\begin{vmatrix}1&2&3\\4&5&6\\7&8&9\end{vmatrix}$.`,
          0,
          r`Row$_3$ − Row$_2$ = $(3,3,3)$ and Row$_2$ − Row$_1$ = $(3,3,3)$, so the rows are linearly dependent and the determinant is $0$.`,
          { d: 'Medium', tags: ['determinants'] },
        ),
        num(
          r`If $A$ is a $3\times3$ matrix with $|A|=5$, find $|2A|$.`,
          40,
          r`Scaling a matrix of order $n$ by $k$ multiplies the determinant by $k^n$: $|2A|=2^3|A|=8\times5=40$.`,
          { d: 'Medium', tags: ['determinants', 'scaling'] },
        ),
        tf(
          r`For any square matrix $A$, $\ |A^{T}|=|A|$.`,
          true,
          r`True — transposing swaps rows and columns, and the determinant is unchanged by this. It is why row operations and column operations have identical effects on a determinant.`,
          { d: 'Easy', tags: ['determinants', 'transpose'] },
        ),
        num(
          r`Find the area, in square units, of the triangle with vertices $(0,0)$, $(1,0)$ and $(0,1)$.`,
          0.5,
          r`Area $=\dfrac12\left|\begin{vmatrix}0&0&1\\1&0&1\\0&1&1\end{vmatrix}\right| = \dfrac12|{-1}| = \dfrac12$. It is simply half the unit square.`,
          { d: 'Easy', tol: 0.001, tags: ['determinants', 'area'] },
        ),
        num(
          r`If $A$ is a $3\times3$ matrix with $|A|=4$, find $|\text{adj}\,A|$.`,
          16,
          r`For an $n\times n$ matrix, $|\text{adj}\,A|=|A|^{n-1}$. With $n=3$, that is $4^{2}=16$.`,
          { d: 'Hard', tags: ['determinants', 'adjoint'] },
        ),
        tf(
          r`A square matrix $A$ is invertible if and only if $|A|\neq0$.`,
          true,
          r`True. $A^{-1}=\dfrac{1}{|A|}\text{adj}\,A$, which exists exactly when $|A|\neq0$. A matrix with zero determinant is singular.`,
          { d: 'Easy', tags: ['determinants', 'inverse'] },
        ),
        sc(
          r`If two rows of a square matrix are identical, its determinant is`,
          r`$0$`,
          [r`$1$`, r`equal to the product of the diagonal entries`, r`undefined`],
          r`Swapping the two identical rows changes the sign of the determinant but leaves the matrix unchanged, so $|A|=-|A|$, giving $|A|=0$.`,
          { d: 'Medium', tags: ['determinants'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Continuity and Differentiability',
      questions: [
        tf(
          r`The function $f(x)=|x|$ is continuous at $x=0$ but not differentiable there.`,
          true,
          r`True. The left and right limits both equal $0=f(0)$, so it is continuous. But the left derivative is $-1$ and the right derivative is $+1$, so no single derivative exists at $0$.`,
          { d: 'Easy', tags: ['continuity', 'differentiability'] },
        ),
        sc(
          r`$\dfrac{d}{dx}\left(\sin x\right)$ equals`,
          r`$\cos x$`,
          [r`$-\cos x$`, r`$\sin x$`, r`$-\sin x$`],
          r`A standard derivative: $\dfrac{d}{dx}\sin x=\cos x$.`,
          { d: 'Easy', tags: ['derivatives'] },
        ),
        num(
          r`If $y=x^{5}$, find $\dfrac{dy}{dx}$ at $x=2$.`,
          80,
          r`$\dfrac{dy}{dx}=5x^{4}$, so at $x=2$ it is $5\times16=80$.`,
          { d: 'Easy', tags: ['derivatives', 'power-rule'] },
        ),
        sc(
          r`$\dfrac{d}{dx}\left(e^{2x}\right)$ equals`,
          r`$2e^{2x}$`,
          [r`$e^{2x}$`, r`$e^{2}$`, r`$2xe^{2x}$`],
          r`By the chain rule, $\dfrac{d}{dx}e^{u}=e^{u}\dfrac{du}{dx}$ with $u=2x$, giving $2e^{2x}$.`,
          { d: 'Easy', tags: ['derivatives', 'chain-rule'] },
        ),
        sc(
          r`If $y=\sin(x^{2})$, then $\dfrac{dy}{dx}$ equals`,
          r`$2x\cos(x^{2})$`,
          [r`$\cos(x^{2})$`, r`$2x\sin(x^{2})$`, r`$\cos(2x)$`],
          r`Chain rule with outer $\sin$ and inner $x^2$: $\cos(x^2)\cdot 2x$.`,
          { d: 'Medium', tags: ['derivatives', 'chain-rule'] },
        ),
        sc(
          r`$\dfrac{d}{dx}\left(\tan x\right)$ equals`,
          r`$\sec^{2}x$`,
          [r`$\sec x\tan x$`, r`$-\csc^{2}x$`, r`$\cot x$`],
          r`Writing $\tan x=\sin x/\cos x$ and using the quotient rule gives $\dfrac{\cos^2x+\sin^2x}{\cos^2x}=\sec^2x$.`,
          { d: 'Easy', tags: ['derivatives'] },
        ),
        sc(
          r`Rolle's theorem for $f$ on $[a,b]$ requires, in addition to continuity on $[a,b]$ and differentiability on $(a,b)$, that`,
          r`$f(a)=f(b)$`,
          [r`$f(a)=0$`, r`$f'(a)=f'(b)$`, r`$f$ be increasing on $[a,b]$`],
          r`Rolle's theorem needs equal endpoint values; it then guarantees some $c\in(a,b)$ with $f'(c)=0$. Without $f(a)=f(b)$ the conclusion is the Mean Value Theorem instead.`,
          { d: 'Medium', tags: ['rolle', 'mvt'] },
        ),
        num(
          r`If $y=\log x$, find $\dfrac{dy}{dx}$ at $x=4$. Give your answer as a decimal correct to two places.`,
          0.25,
          r`$\dfrac{dy}{dx}=\dfrac1x$, so at $x=4$ it is $0.25$.`,
          { d: 'Easy', tol: 0.001, tags: ['derivatives', 'logarithm'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Applications of Derivatives',
      questions: [
        num(
          r`Find the value of $x$ at which $f(x)=x^{2}-4x+3$ attains its minimum.`,
          2,
          r`$f'(x)=2x-4=0$ gives $x=2$, and $f''(x)=2>0$, so it is a minimum.`,
          { d: 'Easy', tags: ['maxima-minima'] },
        ),
        num(
          r`Find the slope of the tangent to $y=x^{2}$ at the point where $x=3$.`,
          6,
          r`The slope is $\dfrac{dy}{dx}=2x$, which at $x=3$ equals $6$.`,
          { d: 'Easy', tags: ['tangent', 'slope'] },
        ),
        tf(
          r`If $f'(x)>0$ on an interval, then $f$ is increasing on that interval.`,
          true,
          r`True. A positive derivative throughout an interval means $f$ is strictly increasing there — a direct consequence of the Mean Value Theorem.`,
          { d: 'Easy', tags: ['monotonicity'] },
        ),
        sc(
          r`The rate of change of the area of a circle with respect to its radius $r$ is`,
          r`$2\pi r$`,
          [r`$\pi r^{2}$`, r`$\pi r$`, r`$4\pi r^{2}$`],
          r`$A=\pi r^2$, so $\dfrac{dA}{dr}=2\pi r$ — which is the circumference, a pleasing fact.`,
          { d: 'Medium', tags: ['rate-of-change'] },
        ),
        sc(
          r`The function $f(x)=x^{3}-3x$ has a local maximum at`,
          r`$x=-1$`,
          [r`$x=1$`, r`$x=0$`, r`$x=3$`],
          r`$f'(x)=3x^2-3=0$ gives $x=\pm1$. Since $f''(x)=6x$, at $x=-1$ we get $f''=-6<0$ (local maximum) and at $x=1$ we get $f''=6>0$ (local minimum).`,
          { d: 'Medium', tags: ['maxima-minima'] },
        ),
        sc(
          r`At a critical point $c$ where $f''(c)>0$, the function $f$ has`,
          r`a local minimum`,
          [r`a local maximum`, r`a point of inflection`, r`no conclusion is possible`],
          r`The second-derivative test: $f'(c)=0$ with $f''(c)>0$ means the curve is concave up there, so $c$ gives a local minimum.`,
          { d: 'Easy', tags: ['second-derivative-test'] },
        ),
        num(
          r`Find the maximum value of $\sin x$ for $x\in\mathbb{R}$.`,
          1,
          r`The sine function oscillates in $[-1,1]$ and attains $1$ at $x=\pi/2$, so its maximum value is $1$.`,
          { d: 'Easy', tags: ['maxima-minima'] },
        ),
        num(
          r`The radius of a circle increases at $3$ cm/s. Find the rate of increase of its area, in cm$^2$/s, when the radius is $5$ cm. Give your answer as a multiple of $\pi$ — that is, give the coefficient of $\pi$.`,
          30,
          r`$\dfrac{dA}{dt}=2\pi r\dfrac{dr}{dt}=2\pi(5)(3)=30\pi$ cm$^2$/s, so the coefficient is $30$.`,
          { d: 'Hard', tags: ['related-rates'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Integrals',
      questions: [
        sc(
          r`$\displaystyle\int x^{2}\,dx$ equals`,
          r`$\dfrac{x^{3}}{3}+C$`,
          [r`$\dfrac{x^{3}}{2}+C$`, r`$2x+C$`, r`$3x^{3}+C$`],
          r`By the power rule for integration, $\displaystyle\int x^{n}dx=\dfrac{x^{n+1}}{n+1}+C$ for $n\neq-1$, giving $x^3/3+C$.`,
          { d: 'Easy', tags: ['integration'] },
        ),
        num(
          r`Evaluate $\displaystyle\int_{0}^{1} x\,dx$. Give your answer as a decimal.`,
          0.5,
          r`$\displaystyle\int_0^1 x\,dx=\left[\dfrac{x^2}{2}\right]_0^1=\dfrac12$.`,
          { d: 'Easy', tol: 0.001, tags: ['definite-integral'] },
        ),
        sc(
          r`$\displaystyle\int \frac{1}{x}\,dx$ equals`,
          r`$\log|x|+C$`,
          [r`$\dfrac{1}{2x^{2}}+C$`, r`$-\dfrac{1}{x^{2}}+C$`, r`$x\log x+C$`],
          r`This is the exception to the power rule. The absolute value matters: the antiderivative is valid on either side of $0$.`,
          { d: 'Easy', tags: ['integration', 'logarithm'] },
        ),
        num(
          r`Evaluate $\displaystyle\int_{0}^{\pi/2}\sin x\,dx$.`,
          1,
          r`$\displaystyle\int_0^{\pi/2}\sin x\,dx=\left[-\cos x\right]_0^{\pi/2}=-\cos(\pi/2)+\cos 0=0+1=1$.`,
          { d: 'Medium', tags: ['definite-integral', 'trigonometry'] },
        ),
        sc(
          r`$\displaystyle\int \sec^{2}x\,dx$ equals`,
          r`$\tan x+C$`,
          [r`$\sec x\tan x+C$`, r`$-\cot x+C$`, r`$\log|\sec x|+C$`],
          r`Since $\dfrac{d}{dx}\tan x=\sec^2x$, integrating $\sec^2x$ returns $\tan x+C$.`,
          { d: 'Easy', tags: ['integration'] },
        ),
        num(
          r`Evaluate $\displaystyle\int_{-1}^{1} x^{3}\,dx$.`,
          0,
          r`$x^3$ is an odd function and the interval is symmetric about $0$, so the integral vanishes. Directly: $\left[x^4/4\right]_{-1}^{1}=\frac14-\frac14=0$.`,
          { d: 'Medium', tags: ['definite-integral', 'symmetry'] },
        ),
        num(
          r`Evaluate $\displaystyle\int_{0}^{1} x^{2}\,dx$, correct to three decimal places.`,
          0.333,
          r`$\left[\dfrac{x^3}{3}\right]_0^1=\dfrac13\approx0.333$.`,
          { d: 'Easy', tol: 0.002, tags: ['definite-integral'] },
        ),
        sc(
          r`$\displaystyle\int e^{x}\,dx$ equals`,
          r`$e^{x}+C$`,
          [r`$xe^{x}+C$`, r`$\dfrac{e^{x}}{x}+C$`, r`$e^{x+1}+C$`],
          r`The exponential function is its own derivative, so it is also its own antiderivative up to the constant.`,
          { d: 'Easy', tags: ['integration', 'exponential'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Applications of Integrals',
      questions: [
        num(
          r`Find the area, in square units, bounded by $y=x$, the $x$-axis and the lines $x=0$ and $x=2$.`,
          2,
          r`Area $=\displaystyle\int_0^2 x\,dx=\left[\dfrac{x^2}{2}\right]_0^2=2$. It is a triangle of base $2$ and height $2$.`,
          { d: 'Easy', tags: ['area'] },
        ),
        num(
          r`Find the area, in square units, under $y=x^{2}$ from $x=0$ to $x=3$.`,
          9,
          r`$\displaystyle\int_0^3 x^2dx=\left[\dfrac{x^3}{3}\right]_0^3=\dfrac{27}{3}=9$.`,
          { d: 'Easy', tags: ['area'] },
        ),
        num(
          r`Find the area, in square units, enclosed between $y=x^{2}$ and $y=x$ from $x=0$ to $x=1$, correct to three decimal places.`,
          0.167,
          r`On $[0,1]$ the line lies above the parabola, so the area is $\displaystyle\int_0^1(x-x^2)dx=\dfrac12-\dfrac13=\dfrac16\approx0.167$.`,
          { d: 'Hard', tol: 0.002, tags: ['area', 'between-curves'] },
        ),
        num(
          r`Find the area, in square units, under one arch of $y=\sin x$, from $x=0$ to $x=\pi$.`,
          2,
          r`$\displaystyle\int_0^{\pi}\sin x\,dx=\left[-\cos x\right]_0^{\pi}=1+1=2$.`,
          { d: 'Medium', tags: ['area', 'trigonometry'] },
        ),
        num(
          r`The area of a circle of radius $2$ is $k\pi$ square units. Find $k$.`,
          4,
          r`$A=\pi r^2=\pi(2)^2=4\pi$, so $k=4$. By integration, $2\displaystyle\int_{-2}^{2}\sqrt{4-x^2}\,dx$ gives the same.`,
          { d: 'Easy', tags: ['area', 'circle'] },
        ),
        num(
          r`Find the area, in square units, of the region bounded by $y=4-x^{2}$ and the $x$-axis, correct to two decimal places.`,
          10.67,
          r`The curve meets the axis at $x=\pm2$, so the area is $\displaystyle\int_{-2}^{2}(4-x^2)dx=\left[4x-\dfrac{x^3}{3}\right]_{-2}^{2}=\dfrac{32}{3}\approx10.67$.`,
          { d: 'Hard', tol: 0.02, tags: ['area', 'parabola'] },
        ),
        num(
          r`Find the area, in square units, under $y=e^{x}$ from $x=0$ to $x=1$, correct to three decimal places.`,
          1.718,
          r`$\displaystyle\int_0^1e^xdx=\left[e^x\right]_0^1=e-1\approx1.718$.`,
          { d: 'Medium', tol: 0.005, tags: ['area', 'exponential'] },
        ),
        tf(
          r`A definite integral $\displaystyle\int_a^b f(x)\,dx$ can be negative, even though an area cannot.`,
          true,
          r`True. Where $f$ is below the axis the integral contributes a negative amount. To obtain the geometric area one integrates $|f(x)|$, splitting the interval at the zeros of $f$.`,
          { d: 'Medium', tags: ['area', 'definite-integral'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Differential Equations',
      questions: [
        num(
          r`Find the order of the differential equation $\dfrac{d^{2}y}{dx^{2}}+y=0$.`,
          2,
          r`The order is the highest derivative present, which here is the second derivative, so the order is $2$.`,
          { d: 'Easy', tags: ['differential-equations', 'order'] },
        ),
        num(
          r`Find the degree of the differential equation $\left(\dfrac{dy}{dx}\right)^{3}+y=0$.`,
          3,
          r`The degree is the highest power of the highest-order derivative, once the equation is polynomial in its derivatives. Here that power is $3$.`,
          { d: 'Medium', tags: ['differential-equations', 'degree'] },
        ),
        sc(
          r`The general solution of $\dfrac{dy}{dx}=y$ is`,
          r`$y=Ce^{x}$`,
          [r`$y=Cx$`, r`$y=e^{x}+C$`, r`$y=\log x+C$`],
          r`Separating variables, $\displaystyle\int\dfrac{dy}{y}=\int dx$ gives $\log|y|=x+k$, so $y=Ce^{x}$.`,
          { d: 'Medium', tags: ['differential-equations', 'separable'] },
        ),
        sc(
          r`The general solution of $\dfrac{dy}{dx}=x$ is`,
          r`$y=\dfrac{x^{2}}{2}+C$`,
          [r`$y=x^{2}+C$`, r`$y=Cx$`, r`$y=\dfrac{1}{x}+C$`],
          r`Integrating both sides with respect to $x$ gives $y=\dfrac{x^2}{2}+C$.`,
          { d: 'Easy', tags: ['differential-equations'] },
        ),
        sc(
          r`The integrating factor of $\dfrac{dy}{dx}+y=e^{x}$ is`,
          r`$e^{x}$`,
          [r`$e^{-x}$`, r`$x$`, r`$\log x$`],
          r`For $\dfrac{dy}{dx}+Py=Q$ the integrating factor is $e^{\int P\,dx}$. Here $P=1$, so it is $e^{x}$.`,
          { d: 'Hard', tags: ['differential-equations', 'integrating-factor'] },
        ),
        num(
          r`Find the order of the differential equation $\dfrac{dy}{dx}=\sin x$.`,
          1,
          r`Only a first derivative appears, so the order is $1$.`,
          { d: 'Easy', tags: ['differential-equations', 'order'] },
        ),
        tf(
          r`The general solution of an $n$th-order differential equation contains $n$ arbitrary constants.`,
          true,
          r`True. Each integration introduces one constant, so a second-order equation has a two-parameter family of solutions; particular solutions are obtained by imposing $n$ conditions.`,
          { d: 'Medium', tags: ['differential-equations'] },
        ),
        tf(
          r`$y=\sin x$ is a solution of $\dfrac{d^{2}y}{dx^{2}}+y=0$.`,
          true,
          r`True. If $y=\sin x$ then $y''=-\sin x$, so $y''+y=-\sin x+\sin x=0$.`,
          { d: 'Medium', tags: ['differential-equations', 'verification'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Vector Algebra',
      questions: [
        num(
          r`Find $\left|\hat{i}+\hat{j}+\hat{k}\right|$, correct to three decimal places.`,
          1.732,
          r`The magnitude is $\sqrt{1^2+1^2+1^2}=\sqrt3\approx1.732$.`,
          { d: 'Easy', tol: 0.005, tags: ['vectors', 'magnitude'] },
        ),
        num(
          r`Evaluate $\hat{i}\cdot\hat{j}$.`,
          0,
          r`The unit vectors along the axes are mutually perpendicular, and the dot product of perpendicular vectors is $0$.`,
          { d: 'Easy', tags: ['vectors', 'dot-product'] },
        ),
        sc(
          r`$\hat{i}\times\hat{j}$ equals`,
          r`$\hat{k}$`,
          [r`$-\hat{k}$`, r`$0$`, r`$\hat{i}$`],
          r`By the right-hand rule and the cyclic order $\hat i\to\hat j\to\hat k$, the cross product $\hat i\times\hat j=\hat k$. Reversing the order would give $-\hat k$.`,
          { d: 'Easy', tags: ['vectors', 'cross-product'] },
        ),
        num(
          r`If $\vec{a}=\hat{i}+2\hat{j}+3\hat{k}$ and $\vec{b}=4\hat{i}+5\hat{j}+6\hat{k}$, find $\vec{a}\cdot\vec{b}$.`,
          32,
          r`$\vec a\cdot\vec b=1(4)+2(5)+3(6)=4+10+18=32$.`,
          { d: 'Easy', tags: ['vectors', 'dot-product'] },
        ),
        tf(
          r`If $\vec{a}\cdot\vec{b}=0$ with $\vec a,\vec b$ both non-zero, then $\vec{a}$ and $\vec{b}$ are perpendicular.`,
          true,
          r`True. Since $\vec a\cdot\vec b=|\vec a||\vec b|\cos\theta$ and neither magnitude is zero, $\cos\theta=0$, so $\theta=90^\circ$.`,
          { d: 'Easy', tags: ['vectors', 'perpendicular'] },
        ),
        sc(
          r`The unit vector in the direction of $3\hat{i}+4\hat{j}$ is`,
          r`$\dfrac{3}{5}\hat{i}+\dfrac{4}{5}\hat{j}$`,
          [r`$3\hat{i}+4\hat{j}$`, r`$\dfrac{1}{7}(3\hat{i}+4\hat{j})$`, r`$\dfrac{4}{5}\hat{i}+\dfrac{3}{5}\hat{j}$`],
          r`The magnitude is $\sqrt{9+16}=5$, so dividing by $5$ gives the unit vector $\tfrac35\hat i+\tfrac45\hat j$.`,
          { d: 'Medium', tags: ['vectors', 'unit-vector'] },
        ),
        num(
          r`Find $\left|2\hat{i}-3\hat{j}+6\hat{k}\right|$.`,
          7,
          r`$\sqrt{4+9+36}=\sqrt{49}=7$.`,
          { d: 'Easy', tags: ['vectors', 'magnitude'] },
        ),
        tf(
          r`For any two vectors, $\left|\vec{a}\times\vec{b}\right|=|\vec{a}||\vec{b}|\sin\theta$, where $\theta$ is the angle between them.`,
          true,
          r`True — and it is why the cross product's magnitude equals the area of the parallelogram spanned by the two vectors.`,
          { d: 'Medium', tags: ['vectors', 'cross-product'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Three-Dimensional Geometry',
      questions: [
        num(
          r`Find the distance of the point $(2,3,6)$ from the origin.`,
          7,
          r`Distance $=\sqrt{4+9+36}=\sqrt{49}=7$.`,
          { d: 'Easy', tags: ['3d-geometry', 'distance'] },
        ),
        num(
          r`Find the distance of the point $(1,2,3)$ from the origin, correct to three decimal places.`,
          3.742,
          r`$\sqrt{1+4+9}=\sqrt{14}\approx3.742$.`,
          { d: 'Easy', tol: 0.005, tags: ['3d-geometry', 'distance'] },
        ),
        tf(
          r`If $l$, $m$, $n$ are the direction cosines of a line, then $l^{2}+m^{2}+n^{2}=1$.`,
          true,
          r`True. The direction cosines are the components of a unit vector along the line, so the sum of their squares is $1$.`,
          { d: 'Medium', tags: ['3d-geometry', 'direction-cosines'] },
        ),
        sc(
          r`The plane $x=0$ is`,
          r`the $yz$-plane`,
          [r`the $xy$-plane`, r`the $xz$-plane`, r`a plane parallel to the $yz$-plane but not through the origin`],
          r`Setting $x=0$ keeps every point whose $x$-coordinate vanishes, which is exactly the $yz$-plane.`,
          { d: 'Easy', tags: ['3d-geometry', 'planes'] },
        ),
        num(
          r`Find the perpendicular distance from the origin to the plane $x+y+z=3$, correct to three decimal places.`,
          1.732,
          r`Distance $=\dfrac{|0+0+0-3|}{\sqrt{1+1+1}}=\dfrac{3}{\sqrt3}=\sqrt3\approx1.732$.`,
          { d: 'Hard', tol: 0.005, tags: ['3d-geometry', 'distance', 'planes'] },
        ),
        tf(
          r`The line $\dfrac{x}{1}=\dfrac{y}{2}=\dfrac{z}{3}$ passes through the origin.`,
          true,
          r`True. Putting each ratio equal to $0$ gives the point $(0,0,0)$, so the origin lies on the line.`,
          { d: 'Easy', tags: ['3d-geometry', 'lines'] },
        ),
        sc(
          r`The direction ratios of the $x$-axis are`,
          r`$1,0,0$`,
          [r`$0,1,0$`, r`$0,0,1$`, r`$1,1,1$`],
          r`The $x$-axis points along $\hat i$, so its direction ratios are $1,0,0$.`,
          { d: 'Easy', tags: ['3d-geometry', 'direction-ratios'] },
        ),
        num(
          r`Two planes have normals that are perpendicular to each other. Find the angle between the planes, in degrees.`,
          90,
          r`The angle between two planes equals the angle between their normals, so perpendicular normals give $90^\circ$.`,
          { d: 'Medium', tags: ['3d-geometry', 'planes', 'angle'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Linear Programming',
      questions: [
        tf(
          r`The feasible region of a linear programming problem is always a convex set.`,
          true,
          r`True. It is an intersection of half-planes, and any intersection of convex sets is convex. This is why an optimum can always be sought at a corner.`,
          { d: 'Medium', tags: ['lpp', 'feasible-region'] },
        ),
        num(
          r`Maximise $Z=x+y$ subject to $x+y\le4$, $x\ge0$, $y\ge0$.`,
          4,
          r`$Z$ is exactly the quantity bounded by the constraint, so its greatest value is $4$, attained anywhere on the segment $x+y=4$ within the first quadrant.`,
          { d: 'Easy', tags: ['lpp', 'maximisation'] },
        ),
        tf(
          r`If a linear programming problem has an optimal solution and its feasible region is bounded, that optimum occurs at a corner point of the region.`,
          true,
          r`True — the corner-point theorem. A linear objective attains its extremes on the boundary, and for a bounded polygonal region that means at a vertex.`,
          { d: 'Medium', tags: ['lpp', 'corner-point'] },
        ),
        num(
          r`Minimise $Z=2x+3y$ subject to $x\ge0$, $y\ge0$.`,
          0,
          r`Both coefficients are positive and both variables are bounded below by $0$, so the least value is at $(0,0)$, giving $Z=0$.`,
          { d: 'Easy', tags: ['lpp', 'minimisation'] },
        ),
        num(
          r`How many corner points does the feasible region $x\ge0$, $y\ge0$, $x+y\le2$ have?`,
          3,
          r`The region is the triangle with vertices $(0,0)$, $(2,0)$ and $(0,2)$ — three corner points.`,
          { d: 'Medium', tags: ['lpp', 'corner-point'] },
        ),
        tf(
          r`A linear programming problem whose feasible region is unbounded may have no maximum value.`,
          true,
          r`True. If the objective can be increased indefinitely along a direction in which the region extends, no maximum exists — though a minimum may still exist.`,
          { d: 'Medium', tags: ['lpp', 'unbounded'] },
        ),
        num(
          r`Find the value of $Z=3x+4y$ at the point $(2,0)$.`,
          6,
          r`Substituting, $Z=3(2)+4(0)=6$.`,
          { d: 'Easy', tags: ['lpp', 'objective-function'] },
        ),
        sc(
          r`In a linear programming problem, the constraints are`,
          r`linear inequalities or equations in the decision variables`,
          [r`always strict inequalities`, r`quadratic inequalities`, r`arbitrary functions of the variables`],
          r`Both the objective and the constraints must be linear — that is what makes the problem *linear* programming and what guarantees the corner-point property.`,
          { d: 'Easy', tags: ['lpp', 'constraints'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Probability',
      questions: [
        num(
          r`Two fair coins are tossed. Find the probability that both show heads. Give your answer as a decimal.`,
          0.25,
          r`The four equally likely outcomes are HH, HT, TH, TT, and only one is HH, so the probability is $1/4=0.25$.`,
          { d: 'Easy', tol: 0.001, tags: ['probability'] },
        ),
        num(
          r`A fair die is rolled once. Find the probability of an even number. Give your answer as a decimal.`,
          0.5,
          r`The even outcomes are $2,4,6$ — three of six, so the probability is $1/2=0.5$.`,
          { d: 'Easy', tol: 0.001, tags: ['probability'] },
        ),
        tf(
          r`For any two events, $P(A\cup B)=P(A)+P(B)-P(A\cap B)$.`,
          true,
          r`True — the addition theorem. Simply adding $P(A)$ and $P(B)$ would count the overlap twice, so it is subtracted once.`,
          { d: 'Easy', tags: ['probability', 'addition-theorem'] },
        ),
        sc(
          r`For two events $A$ and $B$ with $P(B)>0$, the conditional probability $P(A\mid B)$ equals`,
          r`$\dfrac{P(A\cap B)}{P(B)}$`,
          [r`$\dfrac{P(A\cap B)}{P(A)}$`, r`$P(A)P(B)$`, r`$\dfrac{P(A)}{P(B)}$`],
          r`Conditioning on $B$ restricts the sample space to $B$, so the favourable part is $A\cap B$ measured relative to $P(B)$.`,
          { d: 'Medium', tags: ['probability', 'conditional'] },
        ),
        tf(
          r`Two events $A$ and $B$ are independent if and only if $P(A\cap B)=P(A)\,P(B)$.`,
          true,
          r`True — this is the definition of independence. It is not the same as being mutually exclusive; in fact two events of non-zero probability cannot be both.`,
          { d: 'Medium', tags: ['probability', 'independence'] },
        ),
        num(
          r`One card is drawn from a well-shuffled pack of $52$. Find the probability that it is an ace, correct to four decimal places.`,
          0.0769,
          r`There are $4$ aces, so the probability is $4/52=1/13\approx0.0769$.`,
          { d: 'Easy', tol: 0.0005, tags: ['probability', 'cards'] },
        ),
        num(
          r`Find the probability of a sure event.`,
          1,
          r`A sure event contains every outcome of the sample space, so its probability is $1$.`,
          { d: 'Easy', tags: ['probability'] },
        ),
        num(
          r`Two fair dice are rolled. Find the probability that the sum is $7$, correct to four decimal places.`,
          0.1667,
          r`The favourable pairs are $(1,6),(2,5),(3,4),(4,3),(5,2),(6,1)$ — six out of $36$, so $6/36=1/6\approx0.1667$.`,
          { d: 'Hard', tol: 0.0005, tags: ['probability', 'dice'] },
        ),
      ],
    },
  ],
};
