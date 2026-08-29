# Cosmic Collisions

**[Live demo → gaploid.github.io/cosmic-collisions](https://gaploid.github.io/cosmic-collisions/)**

Impacts, simulated. Two planets of real mass fall together under their own
gravity and collide — the splash, the tidal arm, the debris disk, and the moon
that gathers out of it. Or a fourteen-kilometre asteroid comes down on the
Yucatán at twenty kilometres a second and opens a ninety-kilometre bowl in
eighty seconds. A page each, over one engine.

- **[Giant impact](https://gaploid.github.io/cosmic-collisions/)** — Theia and
  the proto-Earth, and the Moon that comes out of the disk.
- **[Chicxulub](https://gaploid.github.io/cosmic-collisions/chicxulub.html)** —
  the impact that ended the Cretaceous, at two scales: the crater it digs, and
  the plume that comes out of it and reaches the far side of the world.

## The giant impact

Not a shape to assemble but a simulation. A proto-Earth and an impactor from
0.02 to 1 M⊕, differentiated iron core to mantle to crust, both arriving with an
eight-hour day: 16k to 262k particles, each pulling on all the others, touching
ones pushing back like a stiff spring and bleeding the energy into heat that
stays in the rock and lights it, deep red past 900 K, white past 40 000.

Five presets — *theia*, the canonical Moon-forming impact; *head-on*;
*hit & run*; *twins*; *shatter*. The readout is a fixed table, the same rows in
the same columns from the first look to the last: what stays, what orbits and
what escapes, what Moon that disk would make by the Ida–Canup–Stewart scaling,
and the books on momentum, angular momentum and energy. In the advanced panel,
mass, angle, speed, particle count, bounce, core and density restart the run;
exposure, glow, shading, stars, atmosphere, sparks, lens and drift do not.

Drag rotates · wheel or pinch zooms · Space pauses · R restarts · F follows the
largest body. On a phone it opens at 33k particles and gives back pixels — never
physics — if the frames start to cost too much.

Not SPH — no shocks, no vaporization — but the deformation, the tidal arm, the
disk and the re-accretion are all there.

## Chicxulub

**The crater.** Yucatán carbonate over crystalline basement, and a carbonaceous
asteroid at 20 km/s, 60° from the north-east: the curtain goes up, and the
transient bowl opens in about eighty seconds. Presets run from 1 km to 30 km;
the readout gives energy, ejecta, melt, seismic magnitude, and the crater dug
beside the one the scaling asks for.

**The planet.** The Earth of the giant impact, with a rock thrown at it — and
honest about what it cannot show: a grain is 218 km across and the rock was 14,
so it is drawn as the one grain it is worth, does nothing, and says so. The
surface starts to break a few hundred kilometres up; past 2000 km the
giant-impact page takes over.

**The first day.** The crater as a dot. Nothing deforms, but the plume outruns
the atmosphere, arcs over half a world and is down everywhere within two hours —
that, not the crater, is what ended the Cretaceous.

**The numbers.** A contact model has no shock, so its first second is given to
it: an excavation flow with Housen & Holsapple's speeds and Maxwell's Z-model
directions, stopping at the transient radius π-group scaling gives. Everything
after is the sim's own; the sulfur wants a hydrocode and is quoted, not run.
Sources, as on the page: Collins 2005 and 2020, Housen & Holsapple 2011, Melosh
1989, Expedition 364, Fischer-Gödde 2024.

## Tech

A page per scenario over a shared engine in `src/`, wired with plain script
tags — no dependencies, no build step, and a page still opens from disk. It is
WebGL 2 with no compute shaders to lean on, so the hard parts are tricks:
contacts from a hashed grid filled by depth-peeling, gravity from a 64³ particle
mesh — its far field block to block, so it pushes nothing — with the loose
material corrected pairwise against it, P³M-style, so moonlets bind instead of
smearing. Its bodies are onions of Fibonacci-spiral
shells, relaxed and then crept into equilibrium so that nothing pops out of the
surface; symplectic Euler, Morton order, and books on momentum and energy that
caught most of what was wrong. The picture is screen-space fluid rendering —
impostors, a bilateral blur that melts them into a skin, a coverage cut that
takes the beads off the limb — with a surface drawn in each grain's own
coordinates so it rides the material, and hot rock glowing by its temperature
and lighting everything else. Over that, the cinema: an atmosphere on each
body, integrated along the ray through a shell keyed to the skin's own
silhouette — the steam a young planet wears, until the giant impact blows it
off; the loose hot grains drawn once more as comets, streaked by their own
motion; the bodies' sun shadows on the disk and on each other; convection
cells on the melt; and a lens — the sun's glare walked past the bodies into
shafts, an anamorphic streak and ghosts off the brightest, a heat shimmer,
chromatic aberration, grain, a split tone. GGX, ACES and FXAA; every knob is
in `__impact.look`.

## The sky

The starfield is the real one: the Yale Bright Star Catalogue, every star down
to magnitude 6 — 5080 of them, each carrying its right ascension, declination,
visual magnitude and B-V colour index in six bytes, 30 KB embedded in the page
as base64. They sit on the celestial sphere and turn with the world, with the
Milky Way behind them where it really is.

Star positions from the Bright Star Catalogue, 5th Revised Ed. (Hoffleit &
Warren), via the Harvard/SAO catalogue archive. Public domain / free to use with
credit.

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
