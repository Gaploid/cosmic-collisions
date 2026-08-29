# Cosmic Collisions

**[Live demo → gaploid.github.io/cosmic-collisions](https://gaploid.github.io/cosmic-collisions/)**

*The Moon forming — the canonical Theia impact:*

https://github.com/user-attachments/assets/56ecc852-79bb-46e8-987a-36d0ba89dc8e

*Shatter — half an Earth at 2.6 escape speeds:*

https://github.com/user-attachments/assets/5298d38b-920a-47ee-8cc2-dfe8c6677141

Impacts, simulated. Two planets of real mass fall together under their own
gravity and collide — the splash, the tidal arm, the debris disk, and the moon
that gathers out of it. Or a fourteen-kilometre asteroid comes down on the
Yucatán at twenty kilometres a second and opens a ninety-kilometre bowl in
eighty seconds. A page each, over one engine.

## Scenarios

**[Giant impact](https://gaploid.github.io/cosmic-collisions/)** — a proto-Earth
and an impactor from 0.02 to 1 M⊕, iron core to mantle to crust, 16k to 262k
particles falling together under their own gravity: the splash, the tidal arm,
the disk, and the Moon that gathers out of it. Five *what if*s — the canonical
*theia*; a Theia grown to Earth's own mass (*twins*); one coming in flat and
dead-on (*head-on*); one grazing too fast to be caught (*hit & run*); one fast
enough to take both bodies apart (*shatter*) — and mass, angle, how far above
the plane, speed, bounce, core and density are all knobs, so the next what-if
is a restart away. The readout holds still: what stays, what orbits, what
escapes, the Moon that disk would make, and the books on momentum, angular
momentum and energy. Drag rotates · wheel zooms · Space pauses · R restarts ·
F follows; a phone opens at 33k particles and gives back pixels, never
physics.

**[Chicxulub](https://gaploid.github.io/cosmic-collisions/chicxulub.html)** —
the impact that ended the Cretaceous, at two scales. *The crater:* Yucatán
carbonate over crystalline basement, a carbonaceous asteroid at 20 km/s and 60°
from the north-east; the curtain goes up and the transient bowl opens in about
eighty seconds, with presets from 1 km to 30 km and a readout of energy, ejecta,
melt and seismic magnitude. *The first day:* the crater is a dot, but the plume
outruns the atmosphere, arcs over half a world and is down everywhere within two
hours — that, not the crater, is what ended the Cretaceous. Between them sits a
breakable Earth, honest about what it cannot show: a grain is 218 km across and
the rock was 14, so it is drawn as the one grain it is worth, does nothing, and
says so. Sources, as on the page: Collins 2005 and 2020, Housen & Holsapple
2011, Melosh 1989, Expedition 364, Fischer-Gödde 2024.

## Simulation

What runs:

- **Gravity, from the particles themselves.** A 64³ particle mesh with a
  block-to-block far field, and everything loose — the arm, the disk, the
  escapers — corrected pairwise against it, P³M-style, so moonlets bind
  instead of smearing. The Chicxulub crater page swaps it for a constant *g*
  and down: a patch of ground too small to pull on itself.
- **Contact.** A spring-dashpot along the line between two touching grains,
  with no tension: the material resists being squeezed, and can be pulled
  apart for nothing.
- **Heat.** The dashpot's work stays in the rock as a temperature, conducts
  from grain to grain, and lights the scene by it — deep red past 900 K, white
  past 40 000.
- **Structure and spin.** Differentiated bodies, each material with its own
  density and heat capacity, built as onions of Fibonacci shells, relaxed and
  crept into equilibrium, arriving as the Maclaurin spheroid an eight-hour day
  asks for, on a two-body approach solved on the CPU.
- **The books.** Symplectic Euler, and momentum, angular momentum and energy
  kept and shown to a fraction of a percent.
- **The first second at Chicxulub.** A contact model has no shock, so the
  excavation flow is given to it — Housen & Holsapple's speeds, Maxwell's
  Z-model directions, stopping at the transient radius π-group scaling asks
  for. Everything after that is the sim's own.

What does not:

- **No SPH, no equation of state** — no pressure, no shock, no vaporization.
  The deformation, the tidal arm, the disk and the re-accretion are all there;
  the phase change is not.
- **No strength** — no cohesion, no tensile strength, no fracture, no friction
  across a contact. The rock is a pile of grains that resists compression and
  nothing else.
- **No cooling, no latent heat** — over the hours a run covers nothing
  radiates away, and melting and freezing cost nothing.
- **No fluid air or ocean** — the atmosphere a body wears is drawn, not
  solved, and what a giant impact strips off it is a rule of thumb.
- **No chemistry, no climate** — Chicxulub's sulfur and the winter after it
  want a hydrocode; they are quoted on the page, not run.
- **Resolution** — a grain of Earth is a couple of hundred kilometres across,
  so anything smaller is a number on the readout rather than a thing on the
  screen.
- **The Moon itself** — the disk is simulated; the Moon it would eventually
  make is the Ida–Canup–Stewart scaling, not a run.

## Tech

A page per scenario over a shared engine in `src/`, wired with plain script
tags — no dependencies, no build step, and a page still opens from disk. It is
WebGL 2 with no compute shaders to lean on, so the hard parts are tricks: the
contact grid is hashed and filled by depth-peeling, standing in for an atomic
counter; the gravity mesh does its far field block to block, so that it never
pushes itself; the particles are kept in Morton order, so a grain's neighbours
sit beside it in the texture. The picture is screen-space fluid rendering —
impostors, a bilateral blur that melts them into a skin, a coverage cut that
takes the beads off the limb — with a surface drawn in each grain's own
coordinates so it rides the material, and hot rock glowing by its temperature
and lighting everything else. Over that, the cinema: an atmosphere on each
body — off until the panel switches it on, since at speed the shell trails
the body — integrated along the ray through a shell keyed to the skin's own
silhouette, the steam a young planet wears until the giant impact blows it
off; the loose hot grains drawn once more as comets, streaked by their own
motion; the bodies' sun shadows on the disk and on each other; convection
cells on the melt; and a lens — the sun's glare walked past the bodies into
shafts, an anamorphic streak and ghosts off the brightest, a heat shimmer,
chromatic aberration, grain, a split tone. GGX, ACES and FXAA; every knob is
in `__impact.look`.

The starfield is the real sky: every star down to magnitude 6 — 5080 of them,
each six bytes of right ascension, declination, magnitude and colour, 30 KB of
base64 in the page — on the celestial sphere, turning with the world, with the
Milky Way behind it where it really is. Positions from the Bright Star
Catalogue, 5th Revised Ed. (Hoffleit & Warren), via the Harvard/SAO catalogue
archive; public domain, free to use with credit.

## Changelog

Broad strokes, newest first; the commit history tells each one in full.

- **2026-08-29 — Surfaces and the melt.** The craters are craters now — a
  floor, a narrow crest, an ejecta blanket, a central peak in the biggest,
  rays off a few fresh ones — in four octaves so that there are four times
  as many at half the size; Earth's crust wears an early ocean over basalt
  islands, with the sun's glint on it, and a cratered crust wears dark maria
  and a regolith grain. The magma ocean convects over its whole face, goes
  to a photosphere's granulation where it is hottest, darkens to its limb,
  and turns with the body it sits on.
- **2026-08-29 — The air, the axis, and keeping up.** The atmosphere is keyed
  to a body's own centre and edge, and a giant impact takes the share of it
  the ground motion throws off — a tenth for Theia, a third for a hit & run,
  all of it for twins and the shatter — with a hole over the impact. Theia
  comes in from above the orbital plane and leaves Earth a 23° tilt, and the
  day and the axis on the readout are the planet's own rather than its
  group's. The picture keeps up at 4× and is whole from the first frame out
  from under the loader.
- **2026-08-28 — The cinema, and the Moon that stays.** The bodies wear an
  atmosphere, the loose hot grains fly as comets, the planet shadows its disk,
  and the film has a lens — shafts, streak, ghosts, shimmer, aberration, grain
  — with thirty thousand faint stars and a camera that drifts until touched,
  for 0.3 ms a frame. The Moon the theia run makes stays in orbit at 4.6 R⊕
  where it used to drift out of the box; the clock reads zero at first touch,
  the step runs twice as fast, and the approach is long enough to see who is
  coming from where.
- **2026-08-27 — A surface, and Chicxulub.** The planet wears a surface
  textured in the coordinates each grain carries from where it sat in its
  body, so the relief turns with the body, stretches with the arm and goes
  with the ejecta. Chicxulub is the second scenario, at the other end of the
  scale: a crater on a patch of ground, the plume's first day over a globe,
  and a breakable Earth built by the engine both pages now share in `src/`.
  The readout became a table that holds still, with a phone's own version.
- **2026-08-26 — Heat, light and the books.** Every particle carries a
  temperature and the rock glows by it, lighting the disk and the second body
  with its own magma, under an ACES tone curve and a real sun. The bodies are
  onions of Fibonacci shells with a feathered skin, they arrive spinning as
  the Maclaurin spheroids their days call for, and the disk binds into
  moonlets with a pairwise correction under the mesh. The readout keeps
  momentum, angular momentum and energy to a fraction of a percent, the step
  runs at 4× on a desk, and a phone holds the same collision at a quarter of
  the particles.
- **2026-08-25 — Impact.** Two planets of real mass — iron core, mantle,
  crust — collide under their own gravity on the GPU, from the canonical
  Moon-forming impact to a hit-and-run, under the real catalogue sky. A
  readout says what stays, what orbits, and what escapes.

The page began as a second page of [stardust](https://github.com/Gaploid/stardust)
and moved into this repository on 2026-08-26, with its history.

## Analytics

This site uses Google Analytics to understand basic usage.

## License

MIT — see [LICENSE](LICENSE).
