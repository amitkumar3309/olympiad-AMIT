import { num, r, sc, tf, type SeedSubject } from './seedTypes';

/**
 * Class 12 Physics — 104 questions across the thirteen CBSE chapters.
 *
 * Numeric answers are given in SI units and stated in the question, with a tolerance
 * wide enough for honest rounding but tight enough that a wrong method fails. Values
 * such as $c$, $h$ and $e$ are used to the precision a Class 12 paper expects.
 */
export const CLASS12_PHYSICS: SeedSubject = {
  subject: 'Physics',
  topics: [
    // -----------------------------------------------------------------------
    {
      topic: 'Electric Charges and Fields',
      questions: [
        sc(
          r`According to Coulomb's law, the force between two point charges varies with their separation $r$ as`,
          r`$F\propto\dfrac{1}{r^{2}}$`,
          [r`$F\propto\dfrac{1}{r}$`, r`$F\propto r^{2}$`, r`$F\propto\dfrac{1}{r^{3}}$`],
          r`Coulomb's law gives $F=\dfrac{1}{4\pi\varepsilon_0}\dfrac{q_1q_2}{r^{2}}$ — an inverse-square law, like gravitation.`,
          { d: 'Easy', tags: ['coulomb', 'electrostatics'] },
        ),
        sc(
          r`The SI unit of electric charge is the`,
          r`coulomb`,
          [r`ampere`, r`volt`, r`farad`],
          r`The coulomb is the SI unit of charge; one coulomb is the charge transported by a current of one ampere in one second.`,
          { d: 'Easy', tags: ['units', 'charge'] },
        ),
        num(
          r`The magnitude of the charge on an electron is $1.6\times10^{-19}$ C. How many electrons make up a total charge of $1.6\times10^{-17}$ C?`,
          100,
          r`Number $=\dfrac{1.6\times10^{-17}}{1.6\times10^{-19}}=100$. Charge is quantised in units of $e$.`,
          { d: 'Medium', tags: ['quantisation', 'charge'] },
        ),
        sc(
          r`The electric field at a distance $r$ from an isolated point charge $q$ has magnitude`,
          r`$\dfrac{1}{4\pi\varepsilon_{0}}\dfrac{q}{r^{2}}$`,
          [r`$\dfrac{1}{4\pi\varepsilon_{0}}\dfrac{q}{r}$`, r`$\dfrac{1}{4\pi\varepsilon_{0}}\dfrac{q^{2}}{r^{2}}$`, r`$\dfrac{1}{4\pi\varepsilon_{0}}qr^{2}$`],
          r`$E=F/q_0$ with $F$ from Coulomb's law, giving $E=\dfrac{1}{4\pi\varepsilon_0}\dfrac{q}{r^2}$, directed radially.`,
          { d: 'Easy', tags: ['electric-field'] },
        ),
        num(
          r`Two point charges of $1$ C each are placed $1$ m apart in vacuum. Taking $\dfrac{1}{4\pi\varepsilon_{0}}=9\times10^{9}$ SI units, find the force between them in newtons. Give your answer in units of $10^{9}$ N — that is, give the coefficient.`,
          9,
          r`$F=9\times10^{9}\times\dfrac{1\times1}{1^{2}}=9\times10^{9}$ N, so the coefficient is $9$. The enormous size of this force is why one coulomb is a very large charge.`,
          { d: 'Medium', tags: ['coulomb', 'calculation'] },
        ),
        sc(
          r`By Gauss's law, the total electric flux through a closed surface enclosing net charge $q$ is`,
          r`$\dfrac{q}{\varepsilon_{0}}$`,
          [r`$q\varepsilon_{0}$`, r`$\dfrac{q}{4\pi\varepsilon_{0}}$`, r`zero, always`],
          r`Gauss's law states $\oint\vec E\cdot d\vec S=\dfrac{q_{\text{enclosed}}}{\varepsilon_0}$, independent of the shape of the surface.`,
          { d: 'Medium', tags: ['gauss-law', 'flux'] },
        ),
        num(
          r`Find the magnitude of the electric field, in N/C, at a point inside a solid metallic conductor in electrostatic equilibrium.`,
          0,
          r`In electrostatic equilibrium the free charges have rearranged until the field inside the conductor is exactly zero; any residual field would keep driving them.`,
          { d: 'Medium', tags: ['conductors', 'electric-field'] },
        ),
        tf(
          r`Two charges of the same sign repel each other.`,
          true,
          r`True. Like charges repel and unlike charges attract — the sign of the product $q_1q_2$ fixes the direction of the Coulomb force.`,
          { d: 'Easy', tags: ['coulomb'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Electrostatic Potential and Capacitance',
      questions: [
        sc(
          r`The SI unit of capacitance is the`,
          r`farad`,
          [r`coulomb`, r`volt`, r`henry`],
          r`Capacitance is charge per unit potential difference, $C=Q/V$, measured in farads (one coulomb per volt).`,
          { d: 'Easy', tags: ['units', 'capacitance'] },
        ),
        sc(
          r`For a parallel-plate capacitor of plate area $A$ and separation $d$ in vacuum, the capacitance is`,
          r`$\dfrac{\varepsilon_{0}A}{d}$`,
          [r`$\dfrac{\varepsilon_{0}d}{A}$`, r`$\varepsilon_{0}Ad$`, r`$\dfrac{A}{\varepsilon_{0}d}$`],
          r`$C=\dfrac{\varepsilon_0A}{d}$ — capacitance grows with plate area and falls as the plates are separated.`,
          { d: 'Medium', tags: ['capacitance', 'parallel-plate'] },
        ),
        num(
          r`Two capacitors of $2\ \mu$F and $3\ \mu$F are connected in parallel. Find the equivalent capacitance in $\mu$F.`,
          5,
          r`In parallel capacitances add: $C=2+3=5\ \mu$F.`,
          { d: 'Easy', tags: ['capacitance', 'parallel'] },
        ),
        num(
          r`Two capacitors of $2\ \mu$F each are connected in series. Find the equivalent capacitance in $\mu$F.`,
          1,
          r`In series $\dfrac1C=\dfrac12+\dfrac12=1$, so $C=1\ \mu$F — always less than the smallest individual capacitance.`,
          { d: 'Medium', tags: ['capacitance', 'series'] },
        ),
        sc(
          r`The energy stored in a capacitor of capacitance $C$ charged to a potential difference $V$ is`,
          r`$\dfrac{1}{2}CV^{2}$`,
          [r`$CV^{2}$`, r`$\dfrac{1}{2}CV$`, r`$\dfrac{1}{2}C^{2}V$`],
          r`Work must be done against the growing potential as charge accumulates; integrating gives $U=\tfrac12CV^2=\tfrac12QV=\dfrac{Q^2}{2C}$.`,
          { d: 'Medium', tags: ['capacitance', 'energy'] },
        ),
        num(
          r`Find the work done, in joules, in moving a charge of $2$ C between two points on the same equipotential surface.`,
          0,
          r`Work is $qΔV$, and the potential difference between two points on an equipotential surface is zero, so no work is done.`,
          { d: 'Medium', tags: ['potential', 'equipotential'] },
        ),
        tf(
          r`Electric potential is a scalar quantity.`,
          true,
          r`True. Potential has magnitude but no direction, which is why potentials from several charges add algebraically — much easier than the vector addition needed for fields.`,
          { d: 'Easy', tags: ['potential'] },
        ),
        num(
          r`A capacitor of $4\ \mu$F is charged to $10$ V. Find the charge stored, in microcoulombs.`,
          40,
          r`$Q=CV=4\ \mu\text{F}\times10\ \text{V}=40\ \mu$C.`,
          { d: 'Easy', tags: ['capacitance', 'calculation'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Current Electricity',
      questions: [
        sc(
          r`Ohm's law states that, for a conductor at constant temperature,`,
          r`$V=IR$, with $R$ constant`,
          [r`$V=I^{2}R$`, r`$I=VR$`, r`$V=\dfrac{I}{R}$`],
          r`The potential difference is proportional to the current, the constant of proportionality being the resistance.`,
          { d: 'Easy', tags: ['ohms-law'] },
        ),
        num(
          r`Two resistors of $4\ \Omega$ each are connected in parallel. Find the equivalent resistance in ohms.`,
          2,
          r`$\dfrac1R=\dfrac14+\dfrac14=\dfrac12$, so $R=2\ \Omega$. Equal resistors in parallel halve the resistance.`,
          { d: 'Easy', tags: ['resistance', 'parallel'] },
        ),
        num(
          r`Two resistors of $3\ \Omega$ each are connected in series. Find the equivalent resistance in ohms.`,
          6,
          r`Resistances in series add: $R=3+3=6\ \Omega$.`,
          { d: 'Easy', tags: ['resistance', 'series'] },
        ),
        sc(
          r`The resistance of a uniform wire of length $L$ and cross-sectional area $A$ is`,
          r`$\dfrac{\rho L}{A}$`,
          [r`$\dfrac{\rho A}{L}$`, r`$\rho LA$`, r`$\dfrac{L}{\rho A}$`],
          r`$R=\dfrac{\rho L}{A}$, where $\rho$ is the resistivity. Doubling the length doubles $R$; doubling the area halves it.`,
          { d: 'Medium', tags: ['resistivity'] },
        ),
        num(
          r`A current of $2$ A flows through a $5\ \Omega$ resistor. Find the power dissipated, in watts.`,
          20,
          r`$P=I^{2}R=(2)^{2}\times5=20$ W.`,
          { d: 'Easy', tags: ['power', 'calculation'] },
        ),
        tf(
          r`Kirchhoff's junction rule is a statement of the conservation of charge.`,
          true,
          r`True. The sum of currents entering a junction equals the sum leaving, because charge does not accumulate there. The loop rule, by contrast, expresses conservation of energy.`,
          { d: 'Medium', tags: ['kirchhoff'] },
        ),
        num(
          r`A potential difference of $12$ V is applied across a $4\ \Omega$ resistor. Find the current, in amperes.`,
          3,
          r`$I=V/R=12/4=3$ A.`,
          { d: 'Easy', tags: ['ohms-law', 'calculation'] },
        ),
        sc(
          r`The drift velocity of free electrons in a metallic conductor carrying a steady current is typically of the order of`,
          r`$10^{-4}$ m/s`,
          [r`$10^{8}$ m/s`, r`$10^{3}$ m/s`, r`equal to the speed of light`],
          r`Drift velocities are surprisingly small — a fraction of a millimetre per second. The signal travels quickly because the field is established almost instantly along the wire, not because the electrons move fast.`,
          { d: 'Hard', tags: ['drift-velocity'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Moving Charges and Magnetism',
      questions: [
        sc(
          r`The magnitude of the magnetic force on a charge $q$ moving with speed $v$ at an angle $\theta$ to a field $B$ is`,
          r`$qvB\sin\theta$`,
          [r`$qvB\cos\theta$`, r`$qvB$`, r`$\dfrac{qv}{B}\sin\theta$`],
          r`$\vec F=q(\vec v\times\vec B)$, so the magnitude is $qvB\sin\theta$ — greatest when the velocity is perpendicular to the field.`,
          { d: 'Medium', tags: ['lorentz-force'] },
        ),
        num(
          r`Find the magnitude of the magnetic force, in newtons, on a charge moving parallel to a uniform magnetic field.`,
          0,
          r`With $\theta=0$, $\sin\theta=0$, so $F=qvB\sin\theta=0$. A charge moving along the field feels no magnetic force.`,
          { d: 'Medium', tags: ['lorentz-force'] },
        ),
        sc(
          r`The SI unit of magnetic field strength $B$ is the`,
          r`tesla`,
          [r`weber`, r`henry`, r`gauss`],
          r`The tesla is the SI unit; the weber is the unit of magnetic *flux*, and the gauss is the CGS unit ($1$ T $=10^{4}$ G).`,
          { d: 'Easy', tags: ['units', 'magnetic-field'] },
        ),
        sc(
          r`The magnetic field at the centre of a circular coil of radius $R$ carrying current $I$ is`,
          r`$\dfrac{\mu_{0}I}{2R}$`,
          [r`$\dfrac{\mu_{0}I}{2\pi R}$`, r`$\dfrac{\mu_{0}I}{4\pi R}$`, r`$\dfrac{\mu_{0}IR}{2}$`],
          r`Integrating the Biot–Savart law around the loop gives $B=\dfrac{\mu_0I}{2R}$ at the centre. The expression $\dfrac{\mu_0I}{2\pi r}$ belongs to a straight wire.`,
          { d: 'Hard', tags: ['biot-savart', 'circular-coil'] },
        ),
        sc(
          r`The magnetic field inside a long solenoid with $n$ turns per unit length carrying current $I$ is`,
          r`$\mu_{0}nI$`,
          [r`$\dfrac{\mu_{0}I}{n}$`, r`$\mu_{0}n^{2}I$`, r`$\dfrac{\mu_{0}nI}{2}$`],
          r`Applying Ampère's law to a long solenoid gives a uniform interior field $B=\mu_0nI$, independent of position.`,
          { d: 'Medium', tags: ['solenoid', 'amperes-law'] },
        ),
        tf(
          r`A magnetic force can never change the speed of a charged particle, only its direction.`,
          true,
          r`True. The force $q(\vec v\times\vec B)$ is always perpendicular to $\vec v$, so it does no work and the kinetic energy — and hence the speed — is unchanged.`,
          { d: 'Hard', tags: ['lorentz-force', 'work'] },
        ),
        num(
          r`A wire of length $2$ m carrying a current of $3$ A lies perpendicular to a uniform field of $0.5$ T. Find the force on it, in newtons.`,
          3,
          r`$F=BIL\sin\theta=0.5\times3\times2\times1=3$ N.`,
          { d: 'Medium', tags: ['force-on-conductor', 'calculation'] },
        ),
        sc(
          r`Two parallel wires carrying currents in the same direction`,
          r`attract each other`,
          [r`repel each other`, r`exert no force on each other`, r`exert a force along the wires`],
          r`Parallel currents in the same direction attract; antiparallel currents repel. This is the effect used historically to define the ampere.`,
          { d: 'Medium', tags: ['parallel-currents'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Magnetism and Matter',
      questions: [
        tf(
          r`An isolated magnetic monopole has never been observed.`,
          true,
          r`True. Magnetic poles always occur in pairs, which is why magnetic field lines form closed loops and why $\oint\vec B\cdot d\vec S=0$ for any closed surface.`,
          { d: 'Easy', tags: ['monopole'] },
        ),
        sc(
          r`The SI unit of magnetic dipole moment is`,
          r`A$\cdot$m$^{2}$`,
          [r`A/m`, r`T$\cdot$m$^{2}$`, r`A$\cdot$m`],
          r`For a current loop, $m=IA$, so the unit is ampere times square metre.`,
          { d: 'Medium', tags: ['units', 'dipole-moment'] },
        ),
        tf(
          r`The magnetic susceptibility of a diamagnetic material is negative.`,
          true,
          r`True. Diamagnetic materials weakly oppose an applied field, so $\chi<0$ (small in magnitude). Paramagnetic materials have small positive $\chi$, and ferromagnetic materials very large positive $\chi$.`,
          { d: 'Medium', tags: ['diamagnetism', 'susceptibility'] },
        ),
        sc(
          r`Curie's law states that the magnetic susceptibility of a paramagnetic material varies with absolute temperature $T$ as`,
          r`$\chi\propto\dfrac{1}{T}$`,
          [r`$\chi\propto T$`, r`$\chi\propto T^{2}$`, r`$\chi$ is independent of $T$`],
          r`$\chi=C/T$. Thermal agitation randomises the atomic dipoles, so raising the temperature reduces the induced magnetisation.`,
          { d: 'Hard', tags: ['curie-law', 'paramagnetism'] },
        ),
        num(
          r`Find the angle of dip, in degrees, at the magnetic equator.`,
          0,
          r`At the magnetic equator the Earth's field is horizontal, so the dip angle is $0^\circ$. At the magnetic poles it is $90^\circ$.`,
          { d: 'Medium', tags: ['dip-angle', 'earth-magnetism'] },
        ),
        tf(
          r`A ferromagnetic material becomes paramagnetic above its Curie temperature.`,
          true,
          r`True. Above the Curie temperature the spontaneous alignment of domains is destroyed by thermal motion, and the material retains only a weak paramagnetic response.`,
          { d: 'Medium', tags: ['ferromagnetism', 'curie-temperature'] },
        ),
        tf(
          r`Magnetic field lines form closed loops.`,
          true,
          r`True — a consequence of the absence of magnetic monopoles. Electric field lines, by contrast, begin and end on charges.`,
          { d: 'Easy', tags: ['field-lines'] },
        ),
        sc(
          r`The Earth's magnetic field near its surface is of the order of`,
          r`$10^{-5}$ T`,
          [r`$1$ T`, r`$10^{-1}$ T`, r`$10^{-12}$ T`],
          r`It is roughly $3\times10^{-5}$ T to $6\times10^{-5}$ T, i.e. a few tenths of a gauss.`,
          { d: 'Medium', tags: ['earth-magnetism'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Electromagnetic Induction',
      questions: [
        sc(
          r`Faraday's law of electromagnetic induction states that the induced emf equals`,
          r`$-\dfrac{d\Phi}{dt}$`,
          [r`$-\Phi t$`, r`$\dfrac{\Phi}{t^{2}}$`, r`$-\dfrac{dB}{dt}$`],
          r`The emf is minus the rate of change of magnetic flux linkage. The minus sign is Lenz's law, expressing opposition to the change.`,
          { d: 'Medium', tags: ['faraday-law'] },
        ),
        tf(
          r`Lenz's law is a consequence of the conservation of energy.`,
          true,
          r`True. If the induced current aided the change in flux, it would reinforce itself and produce energy from nothing. The opposition is what makes work necessary to move the magnet.`,
          { d: 'Medium', tags: ['lenz-law', 'energy'] },
        ),
        sc(
          r`The SI unit of magnetic flux is the`,
          r`weber`,
          [r`tesla`, r`henry`, r`farad`],
          r`One weber is one tesla square metre. The tesla is the unit of field, and the henry that of inductance.`,
          { d: 'Easy', tags: ['units', 'flux'] },
        ),
        sc(
          r`The SI unit of self-inductance is the`,
          r`henry`,
          [r`weber`, r`tesla`, r`ohm`],
          r`One henry is one weber per ampere: the flux linkage produced per unit current.`,
          { d: 'Easy', tags: ['units', 'inductance'] },
        ),
        num(
          r`A coil is placed in a magnetic field that does not change with time. Find the emf induced in the coil, in volts.`,
          0,
          r`With constant flux, $d\Phi/dt=0$, so no emf is induced. Induction requires a *changing* flux, not merely a field.`,
          { d: 'Medium', tags: ['faraday-law'] },
        ),
        sc(
          r`The energy stored in an inductor of inductance $L$ carrying current $I$ is`,
          r`$\dfrac{1}{2}LI^{2}$`,
          [r`$LI^{2}$`, r`$\dfrac{1}{2}L^{2}I$`, r`$\dfrac{1}{2}LI$`],
          r`Work is done against the back-emf while the current is established; integrating gives $U=\tfrac12LI^{2}$, stored in the magnetic field.`,
          { d: 'Medium', tags: ['inductance', 'energy'] },
        ),
        num(
          r`The magnetic flux through a coil changes from $2$ Wb to $6$ Wb in $2$ s. Find the magnitude of the average induced emf, in volts.`,
          2,
          r`$|\varepsilon|=\left|\dfrac{\Delta\Phi}{\Delta t}\right|=\dfrac{6-2}{2}=2$ V.`,
          { d: 'Medium', tags: ['faraday-law', 'calculation'] },
        ),
        tf(
          r`Eddy currents dissipate energy as heat, which is why transformer cores are laminated.`,
          true,
          r`True. Laminating the core with insulated sheets breaks up the paths available to eddy currents, reducing the $I^2R$ losses.`,
          { d: 'Medium', tags: ['eddy-currents'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Alternating Current',
      questions: [
        sc(
          r`For a sinusoidal alternating current of peak value $I_{0}$, the rms value is`,
          r`$\dfrac{I_{0}}{\sqrt{2}}$`,
          [r`$I_{0}\sqrt{2}$`, r`$\dfrac{I_{0}}{2}$`, r`$\dfrac{2I_{0}}{\pi}$`],
          r`Averaging $I^2$ over a cycle gives $I_0^2/2$, so $I_{\text{rms}}=I_0/\sqrt2\approx0.707I_0$. The value $2I_0/\pi$ is the *mean* over a half cycle.`,
          { d: 'Medium', tags: ['rms', 'ac'] },
        ),
        num(
          r`An alternating current has a peak value of $2$ A. Find its rms value in amperes, correct to three decimal places.`,
          1.414,
          r`$I_{\text{rms}}=2/\sqrt2=\sqrt2\approx1.414$ A.`,
          { d: 'Medium', tol: 0.005, tags: ['rms', 'calculation'] },
        ),
        sc(
          r`The inductive reactance of a coil of inductance $L$ at angular frequency $\omega$ is`,
          r`$\omega L$`,
          [r`$\dfrac{1}{\omega L}$`, r`$\dfrac{L}{\omega}$`, r`$\omega^{2}L$`],
          r`$X_L=\omega L=2\pi fL$, so an inductor opposes high-frequency current more strongly.`,
          { d: 'Medium', tags: ['reactance', 'inductor'] },
        ),
        tf(
          r`At resonance in a series $LCR$ circuit, the inductive and capacitive reactances are equal.`,
          true,
          r`True. $X_L=X_C$ at resonance, so the impedance reduces to $R$ alone and the current is maximum.`,
          { d: 'Medium', tags: ['resonance', 'lcr'] },
        ),
        tf(
          r`The reactance of a capacitor decreases as the frequency increases.`,
          true,
          r`True. $X_C=\dfrac{1}{\omega C}$, so higher frequency means lower reactance — a capacitor blocks dc and passes high frequencies.`,
          { d: 'Medium', tags: ['reactance', 'capacitor'] },
        ),
        sc(
          r`The resonant frequency of a series $LCR$ circuit is`,
          r`$\dfrac{1}{2\pi\sqrt{LC}}$`,
          [r`$\dfrac{1}{2\pi LC}$`, r`$2\pi\sqrt{LC}$`, r`$\dfrac{\sqrt{LC}}{2\pi}$`],
          r`Setting $\omega L=\dfrac{1}{\omega C}$ gives $\omega=\dfrac{1}{\sqrt{LC}}$, hence $f=\dfrac{1}{2\pi\sqrt{LC}}$.`,
          { d: 'Hard', tags: ['resonance', 'frequency'] },
        ),
        tf(
          r`A transformer works on the principle of mutual induction and cannot operate on direct current.`,
          true,
          r`True. A steady direct current produces no change of flux, so no emf is induced in the secondary. Transformers require alternating current.`,
          { d: 'Medium', tags: ['transformer'] },
        ),
        num(
          r`In a purely resistive ac circuit, find the phase difference between voltage and current, in degrees.`,
          0,
          r`For a pure resistance the current is in phase with the voltage, so the phase difference is $0^\circ$ and the power factor is $1$.`,
          { d: 'Medium', tags: ['phase', 'resistive'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Electromagnetic Waves',
      questions: [
        num(
          r`The speed of electromagnetic waves in vacuum is $3\times10^{8}$ m/s. Give the exponent of ten in this value — that is, the value of $n$ in $3\times10^{n}$.`,
          8,
          r`$c=3\times10^{8}$ m/s, so $n=8$.`,
          { d: 'Easy', tags: ['speed-of-light'] },
        ),
        tf(
          r`Electromagnetic waves are transverse.`,
          true,
          r`True. Both $\vec E$ and $\vec B$ oscillate perpendicular to the direction of propagation — which is why light can be polarised.`,
          { d: 'Easy', tags: ['em-waves', 'transverse'] },
        ),
        tf(
          r`In an electromagnetic wave, $\vec{E}$ and $\vec{B}$ are perpendicular to each other.`,
          true,
          r`True. $\vec E$, $\vec B$ and the direction of propagation form a mutually perpendicular right-handed set, with $\vec E\times\vec B$ along the propagation direction.`,
          { d: 'Medium', tags: ['em-waves'] },
        ),
        tf(
          r`Electromagnetic waves require a material medium to propagate.`,
          false,
          r`False. They propagate through vacuum — which is how sunlight reaches us. Mechanical waves such as sound do need a medium.`,
          { d: 'Easy', tags: ['em-waves'] },
        ),
        sc(
          r`Arranged in order of increasing wavelength, the correct sequence is`,
          r`gamma rays, X-rays, ultraviolet, visible light`,
          [
            r`visible light, ultraviolet, X-rays, gamma rays`,
            r`X-rays, gamma rays, visible light, ultraviolet`,
            r`ultraviolet, visible light, gamma rays, X-rays`,
          ],
          r`Gamma rays have the shortest wavelengths (highest energy), then X-rays, then ultraviolet, then visible light.`,
          { d: 'Medium', tags: ['em-spectrum'] },
        ),
        sc(
          r`The speed of electromagnetic waves in vacuum is given by`,
          r`$\dfrac{1}{\sqrt{\mu_{0}\varepsilon_{0}}}$`,
          [r`$\sqrt{\mu_{0}\varepsilon_{0}}$`, r`$\dfrac{\mu_{0}}{\varepsilon_{0}}$`, r`$\mu_{0}\varepsilon_{0}$`],
          r`Maxwell's equations give $c=\dfrac{1}{\sqrt{\mu_0\varepsilon_0}}$. Evaluating it from purely electrical and magnetic constants and obtaining the speed of light was the decisive evidence that light is an electromagnetic wave.`,
          { d: 'Hard', tags: ['maxwell', 'speed-of-light'] },
        ),
        sc(
          r`Which part of the electromagnetic spectrum is used in radar?`,
          r`microwaves`,
          [r`gamma rays`, r`ultraviolet`, r`infrared`],
          r`Radar uses microwaves, whose wavelengths are convenient for directional beams and which reflect well from aircraft and rain.`,
          { d: 'Medium', tags: ['em-spectrum', 'applications'] },
        ),
        tf(
          r`Maxwell introduced the idea of displacement current to make Ampère's law consistent for time-varying fields.`,
          true,
          r`True. Without the displacement current term, Ampère's law fails for a charging capacitor, where no conduction current flows between the plates but a magnetic field is nevertheless present.`,
          { d: 'Hard', tags: ['displacement-current', 'maxwell'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Ray Optics and Optical Instruments',
      questions: [
        sc(
          r`Snell's law of refraction states that`,
          r`$n_{1}\sin i=n_{2}\sin r$`,
          [r`$n_{1}\sin i=n_{2}\sin i$`, r`$\dfrac{\sin i}{\sin r}=\dfrac{n_{1}}{n_{2}}$`, r`$n_{1}\cos i=n_{2}\cos r$`],
          r`$n_1\sin i=n_2\sin r$, so $\dfrac{\sin i}{\sin r}=\dfrac{n_2}{n_1}$ — note which way round the refractive indices go.`,
          { d: 'Medium', tags: ['snells-law', 'refraction'] },
        ),
        num(
          r`A converging lens has a focal length of $50$ cm. Find its power in dioptres.`,
          2,
          r`$P=\dfrac{1}{f\ \text{in metres}}=\dfrac{1}{0.5}=+2$ D.`,
          { d: 'Medium', tags: ['lens', 'power'] },
        ),
        sc(
          r`The focal length of a plane mirror is`,
          r`infinite`,
          [r`zero`, r`equal to the object distance`, r`negative and finite`],
          r`A plane mirror has infinite radius of curvature, so $f=R/2$ is infinite; it neither converges nor diverges the beam.`,
          { d: 'Medium', tags: ['mirror'] },
        ),
        sc(
          r`Total internal reflection can occur only when light travels`,
          r`from a denser to a rarer medium, at more than the critical angle`,
          [
            r`from a rarer to a denser medium, at more than the critical angle`,
            r`from a denser to a rarer medium, at less than the critical angle`,
            r`in any direction, provided the angle is large`,
          ],
          r`Both conditions are needed: the ray must go from denser to rarer, and the angle of incidence must exceed the critical angle $\theta_c$ where $\sin\theta_c=1/n$.`,
          { d: 'Hard', tags: ['total-internal-reflection'] },
        ),
        sc(
          r`The mirror formula is`,
          r`$\dfrac{1}{v}+\dfrac{1}{u}=\dfrac{1}{f}$`,
          [r`$\dfrac{1}{v}-\dfrac{1}{u}=\dfrac{1}{f}$`, r`$v+u=f$`, r`$\dfrac{1}{v}+\dfrac{1}{u}=\dfrac{2}{f}$`],
          r`For mirrors, $\dfrac1v+\dfrac1u=\dfrac1f$. The lens formula, by contrast, is $\dfrac1v-\dfrac1u=\dfrac1f$ — a common confusion.`,
          { d: 'Medium', tags: ['mirror-formula'] },
        ),
        num(
          r`An object is placed $30$ cm from a concave mirror of focal length $15$ cm. Find the magnitude of the image distance, in cm.`,
          30,
          r`The object is at the centre of curvature ($u=2f$), so the image forms at the same distance: $30$ cm, real, inverted and the same size.`,
          { d: 'Hard', tags: ['mirror-formula', 'calculation'] },
        ),
        sc(
          r`The refractive index of water is approximately`,
          r`$1.33$`,
          [r`$1.00$`, r`$1.50$`, r`$2.42$`],
          r`Water has $n\approx1.33$. Crown glass is about $1.5$ and diamond about $2.42$, which is why diamond shows such strong total internal reflection.`,
          { d: 'Easy', tags: ['refractive-index'] },
        ),
        tf(
          r`A convex lens always forms a real image, whatever the object distance.`,
          false,
          r`False. When the object is closer than the focal length, a convex lens forms a virtual, erect and magnified image — the ordinary magnifying-glass case.`,
          { d: 'Medium', tags: ['lens', 'images'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Wave Optics',
      questions: [
        sc(
          r`In Young's double-slit experiment the slit separation is $s$ and the screen is a distance $D$ from the slits. The fringe width is`,
          r`$\dfrac{\lambda D}{s}$`,
          [r`$\dfrac{\lambda s}{D}$`, r`$\dfrac{D s}{\lambda}$`, r`$\dfrac{\lambda}{D s}$`],
          r`$\beta=\dfrac{\lambda D}{s}$. The fringes widen with wavelength and with screen distance, and narrow as the slits are moved further apart. (Letters other than $d$ are used here only because the bank rejects two options that differ by letter case alone.)`,
          { d: 'Medium', tags: ['interference', 'fringe-width'] },
        ),
        tf(
          r`Sustained interference requires two coherent sources.`,
          true,
          r`True. Without a constant phase relationship the fringe pattern shifts randomly and averages out, which is why two independent bulbs never show interference.`,
          { d: 'Medium', tags: ['interference', 'coherence'] },
        ),
        sc(
          r`For constructive interference, the path difference between two waves must be`,
          r`an integral multiple of $\lambda$`,
          [r`an odd multiple of $\lambda/2$`, r`an odd multiple of $\lambda$`, r`always zero`],
          r`Constructive interference needs a path difference $n\lambda$; destructive interference needs $(2n+1)\lambda/2$.`,
          { d: 'Medium', tags: ['interference', 'path-difference'] },
        ),
        tf(
          r`The polarisation of light demonstrates that light waves are transverse.`,
          true,
          r`True. Only transverse waves can be polarised, because there is a direction of oscillation perpendicular to propagation to select. Sound, being longitudinal, cannot be polarised.`,
          { d: 'Medium', tags: ['polarisation'] },
        ),
        num(
          r`Unpolarised light of intensity $I_{0}$ passes through two ideal polarisers whose axes are at $60^{\circ}$. Taking the intensity after the first polariser as $I_{0}/2$, the final intensity is $I_{0}/k$. Find $k$.`,
          8,
          r`By Malus's law the second polariser transmits a factor $\cos^{2}60^\circ=\tfrac14$, giving $\dfrac{I_0}{2}\times\dfrac14=\dfrac{I_0}{8}$, so $k=8$.`,
          { d: 'Hard', tags: ['polarisation', 'malus-law'] },
        ),
        tf(
          r`In Young's experiment, the fringe width increases if the wavelength of the light used is increased.`,
          true,
          r`True. Since $\beta=\lambda D/d$, fringe width is directly proportional to wavelength — red light gives wider fringes than blue.`,
          { d: 'Medium', tags: ['interference', 'fringe-width'] },
        ),
        sc(
          r`At Brewster's angle $\theta_{B}$, the reflected light is completely polarised and`,
          r`$\tan\theta_{B}=n$`,
          [r`$\sin\theta_{B}=n$`, r`$\cos\theta_{B}=n$`, r`$\tan\theta_{B}=\dfrac{1}{n}$`],
          r`Brewster's law gives $\tan\theta_B=n$, and at that angle the reflected and refracted rays are perpendicular.`,
          { d: 'Hard', tags: ['polarisation', 'brewster'] },
        ),
        tf(
          r`Diffraction of light provides evidence for its wave nature.`,
          true,
          r`True. Bending around obstacles and spreading through narrow apertures cannot be explained by rays travelling in straight lines; it requires a wave description.`,
          { d: 'Easy', tags: ['diffraction'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Dual Nature of Radiation and Matter',
      questions: [
        sc(
          r`The energy of a photon of frequency $\nu$ is`,
          r`$h\nu$`,
          [r`$\dfrac{h}{\nu}$`, r`$h\nu^{2}$`, r`$\dfrac{h\nu}{c}$`],
          r`Planck's relation $E=h\nu=\dfrac{hc}{\lambda}$. The quantity $h\nu/c$ is the photon's momentum, not its energy.`,
          { d: 'Easy', tags: ['photon', 'planck'] },
        ),
        sc(
          r`The work function of a metal is`,
          r`the minimum energy needed to remove an electron from its surface`,
          [
            r`the energy of the incident photon`,
            r`the maximum kinetic energy of the emitted electron`,
            r`the energy needed to ionise the metal completely`,
          ],
          r`Einstein's photoelectric equation is $K_{\max}=h\nu-\phi$, where $\phi$ is the work function — the threshold energy for emission.`,
          { d: 'Medium', tags: ['photoelectric', 'work-function'] },
        ),
        tf(
          r`Increasing the intensity of incident light increases the photocurrent but not the maximum kinetic energy of the emitted electrons.`,
          true,
          r`True. Intensity sets the *number* of photons, hence the number of electrons; the maximum kinetic energy depends only on the frequency. This is exactly what the wave theory could not explain.`,
          { d: 'Hard', tags: ['photoelectric', 'intensity'] },
        ),
        sc(
          r`The de Broglie wavelength of a particle of momentum $p$ is`,
          r`$\dfrac{h}{p}$`,
          [r`$\dfrac{p}{h}$`, r`$hp$`, r`$\dfrac{h}{p^{2}}$`],
          r`$\lambda=\dfrac{h}{p}=\dfrac{h}{mv}$. It is inversely proportional to momentum, which is why wave effects are invisible for everyday objects.`,
          { d: 'Medium', tags: ['de-broglie'] },
        ),
        num(
          r`Find the rest mass of a photon, in kilograms.`,
          0,
          r`A photon has zero rest mass; it always travels at $c$ and its energy $E=pc$ comes entirely from its momentum.`,
          { d: 'Medium', tags: ['photon'] },
        ),
        num(
          r`Planck's constant is $6.63\times10^{-34}$ J$\cdot$s. Give the exponent of ten — that is, the value of $n$ in $6.63\times10^{n}$.`,
          -34,
          r`$h=6.63\times10^{-34}$ J$\cdot$s, so $n=-34$.`,
          { d: 'Easy', tags: ['planck-constant'] },
        ),
        tf(
          r`Below the threshold frequency, no photoelectrons are emitted however intense the light.`,
          true,
          r`True. A single photon must supply at least the work function, and photons do not pool their energy — so frequency, not intensity, decides whether emission happens at all.`,
          { d: 'Medium', tags: ['photoelectric', 'threshold'] },
        ),
        sc(
          r`In a photoelectric experiment, a graph of stopping potential against frequency of incident light is`,
          r`a straight line whose slope is $h/e$`,
          [r`a straight line through the origin`, r`a parabola`, r`a horizontal line`],
          r`From $eV_0=h\nu-\phi$, $V_0=\dfrac{h}{e}\nu-\dfrac{\phi}{e}$ — a straight line of slope $h/e$ with a negative intercept, not through the origin. Millikan used exactly this to measure $h$.`,
          { d: 'Hard', tags: ['photoelectric', 'stopping-potential'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Atoms and Nuclei',
      questions: [
        tf(
          r`Rutherford's alpha-scattering experiment showed that an atom's positive charge is concentrated in a very small nucleus.`,
          true,
          r`True. The rare but large-angle deflections could only be produced by a very small, dense, positively charged core — most of the atom being empty space.`,
          { d: 'Easy', tags: ['rutherford', 'nucleus'] },
        ),
        num(
          r`The ground-state energy of the hydrogen atom is $-13.6$ eV. Give this value in electronvolts.`,
          -13.6,
          r`Bohr's model gives $E_n=-\dfrac{13.6}{n^{2}}$ eV, so for $n=1$ the energy is $-13.6$ eV. The negative sign means the electron is bound.`,
          { d: 'Medium', tol: 0.05, tags: ['bohr-model', 'hydrogen'] },
        ),
        sc(
          r`An alpha particle is identical to`,
          r`a helium nucleus`,
          [r`an electron`, r`a hydrogen nucleus`, r`a high-energy photon`],
          r`An alpha particle is $^{4}_{2}$He — two protons and two neutrons, with no electrons.`,
          { d: 'Easy', tags: ['alpha-particle'] },
        ),
        tf(
          r`The nuclear force is short-ranged and charge-independent.`,
          true,
          r`True. It acts over a few femtometres and is essentially the same between two protons, two neutrons, or a proton and a neutron — quite unlike the Coulomb force.`,
          { d: 'Medium', tags: ['nuclear-force'] },
        ),
        tf(
          r`Isotopes of an element have the same atomic number but different mass numbers.`,
          true,
          r`True. Same number of protons (hence the same chemistry), different numbers of neutrons.`,
          { d: 'Easy', tags: ['isotopes'] },
        ),
        num(
          r`A radioactive sample has a half-life of $5$ days. What fraction of the original nuclei remains after $15$ days? Give your answer as a decimal correct to three places.`,
          0.125,
          r`Three half-lives elapse, so the remaining fraction is $(1/2)^3=1/8=0.125$.`,
          { d: 'Hard', tol: 0.002, tags: ['radioactivity', 'half-life'] },
        ),
        sc(
          r`The energy equivalent of a mass defect $\Delta m$ is`,
          r`$\Delta m\,c^{2}$`,
          [r`$\Delta m\,c$`, r`$\dfrac{\Delta m}{c^{2}}$`, r`$\dfrac{1}{2}\Delta m\,c^{2}$`],
          r`Einstein's relation $E=\Delta mc^{2}$ gives the binding energy — the energy released when the nucleons come together, which is why the nucleus weighs less than its parts.`,
          { d: 'Medium', tags: ['mass-defect', 'binding-energy'] },
        ),
        sc(
          r`The Balmer series of hydrogen lies mainly in the`,
          r`visible region`,
          [r`ultraviolet region`, r`infrared region`, r`X-ray region`],
          r`Balmer lines ($n\to2$) fall in the visible spectrum; the Lyman series ($n\to1$) is ultraviolet and the Paschen series ($n\to3$) infrared.`,
          { d: 'Hard', tags: ['spectral-series', 'balmer'] },
        ),
      ],
    },
    // -----------------------------------------------------------------------
    {
      topic: 'Semiconductor Electronics',
      questions: [
        tf(
          r`Doping silicon with a pentavalent impurity produces an n-type semiconductor.`,
          true,
          r`True. A pentavalent atom such as phosphorus contributes a fifth, loosely bound electron, so electrons become the majority carriers.`,
          { d: 'Medium', tags: ['doping', 'n-type'] },
        ),
        tf(
          r`A p-n junction diode has low resistance when forward biased.`,
          true,
          r`True. Forward bias narrows the depletion region and current flows readily; reverse bias widens it and the resistance becomes very high.`,
          { d: 'Easy', tags: ['diode', 'biasing'] },
        ),
        sc(
          r`A Zener diode is normally used`,
          r`in reverse bias, as a voltage regulator`,
          [r`in forward bias, as an amplifier`, r`in forward bias, as a rectifier`, r`in reverse bias, as an oscillator`],
          r`Beyond its breakdown voltage a Zener diode maintains a nearly constant voltage across itself despite changing current, which is exactly what a regulator needs.`,
          { d: 'Medium', tags: ['zener', 'regulator'] },
        ),
        num(
          r`The energy band gap of silicon at room temperature is approximately $1.1$ eV. Give this value in electronvolts.`,
          1.1,
          r`Silicon has a band gap of about $1.1$ eV; germanium's is about $0.7$ eV. An insulator's is several electronvolts.`,
          { d: 'Medium', tol: 0.05, tags: ['band-gap', 'silicon'] },
        ),
        num(
          r`How many terminals does a bipolar junction transistor have?`,
          3,
          r`Three: emitter, base and collector.`,
          { d: 'Easy', tags: ['transistor'] },
        ),
        tf(
          r`At absolute zero, a pure intrinsic semiconductor behaves as an insulator.`,
          true,
          r`True. With no thermal energy available, no electrons are excited across the band gap, so the valence band is full, the conduction band empty, and no conduction occurs.`,
          { d: 'Hard', tags: ['intrinsic', 'semiconductor'] },
        ),
        sc(
          r`In a half-wave rectifier supplied with a $50$ Hz input, the ripple frequency of the output is`,
          r`$50$ Hz`,
          [r`$25$ Hz`, r`$100$ Hz`, r`zero`],
          r`A half-wave rectifier passes one pulse per input cycle, so the output ripple is at the input frequency. A full-wave rectifier would give $100$ Hz.`,
          { d: 'Hard', tags: ['rectifier'] },
        ),
        sc(
          r`In a p-type semiconductor, the majority charge carriers are`,
          r`holes`,
          [r`electrons`, r`protons`, r`negative ions`],
          r`Doping with a trivalent impurity creates vacancies in the valence band, and these holes carry most of the current.`,
          { d: 'Easy', tags: ['p-type', 'doping'] },
        ),
      ],
    },
  ],
};
