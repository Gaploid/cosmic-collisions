# Cosmic Collisions

A giant impact, simulated: two planets of real mass fall together under their
own gravity and collide — the splash, the tidal arm, the debris disk, and the
moon that gathers out of it.

**Live: https://gaploid.github.io/cosmic-collisions/**

## What it does

Not a shape to assemble but a simulation. A proto-Earth and an impactor from
0.02 to 1 M⊕, differentiated iron core to mantle to crust, both arriving with an
eight-hour day: 16k to 262k particles, each pulling on all the others, touching
ones pushing back like a stiff spring and bleeding the energy into heat that
stays in the rock and lights it, deep red past 900 K, white past 40 000.

- **Presets** — *theia*, the canonical Moon-forming impact; *head-on*;
  *hit & run*; *twins*; *shatter*.
- **Readout** — it follows the largest body and its disk, says what stays, what
  orbits and what escapes, what Moon that disk would make, and keeps the books
  on momentum, angular momentum and energy.
- **Advanced panel** — impactor mass, impact angle, speed in units of escape
  velocity, particle count, bounce, core fraction and density restart the run;
  exposure, glow, shading and stars do not.

Drag rotates · wheel or pinch zooms · Space pauses · R restarts · F follows the
largest body.

On a phone it opens at 33k particles and draws at fewer pixels than the display
asks for, and gives back pixels — never physics — if the frames start to cost
too much; the particle slider still goes to 262k for anyone who wants to find
out what their phone can do.

Not SPH — no shocks, no vaporization — but the deformation, the tidal arm, the
disk and the re-accretion are all there.

## Tech

One self-contained page, no dependencies and no build step. It is WebGL 2 with
no compute shaders to lean on, so the hard parts are tricks: contacts from a
hashed grid filled by depth-peeling, gravity from a 64³ particle mesh with the
loose material corrected pairwise against it, P³M-style, so moonlets bind
instead of smearing. Its bodies are onions of Fibonacci-spiral shells — a
lattice cut to a sphere is terraced, and the skin drew every step as a ring —
relaxed and then crept into equilibrium so that nothing pops out of the surface.
Symplectic Euler, Morton order, and books on momentum and energy that caught
most of what was wrong. The picture is screen-space fluid rendering — impostors,
a bilateral blur that melts them into a skin, a coverage cut that takes the
beads off the limb — with hot rock glowing by its temperature and lighting
everything else. ACES and FXAA.

## The sky

The starfield is the real one: the Yale Bright Star Catalogue, 5th Revised Ed.,
every star down to magnitude 6 — 5080 of them, each carrying its right
ascension, declination, visual magnitude and B-V colour index in six bytes,
30 KB embedded in the page as base64. They sit on the celestial sphere and turn
with the world.

Star positions from the Bright Star Catalogue, 5th Revised Ed. (Hoffleit &
Warren), via the Harvard/SAO catalogue archive. Public domain / free to use with
credit.

## Analytics

This site uses Google Analytics to understand basic usage.

## Changelog

Broad strokes, newest first; the commit history tells each one in full.

- **2026-08-26 — A phone can hold this.** The run was built for a desk. A phone
  takes the same collision at a quarter of the particles — 33k still splashes,
  still throws a disk, still gathers a moon — at 1.25× rather than the 3× its
  display asks for, and the picture falls to 85 % and then 72 % of a side if the
  frames stop coming, climbing back when they do. The canvas and the readouts
  sit in the viewport the phone actually shows, inside the notch and the home
  bar; held upright the report folds its lines and keeps its books to itself,
  laid on its side the panel takes the room left below it and scrolls the rest.
  Pause and restart are a square with a shape in it now, follow is off the panel
  and lives on the `f` key, and the page picked up Google Analytics.
- **2026-08-26 — A shorter panel.** The advanced panel lost its two spin
  sliders — a spin is a property of the rock, like its density, and both bodies
  keep the eight-hour day they start with — and says the rest in fewer words:
  the units moved into the labels, and a rule marks where the settings that
  restart the run end.
- **2026-08-26 — Skin.** The bodies are built as onions of Fibonacci shells
  instead of a lattice cut to a sphere, so the concentric rings the crust wore
  in every frame are gone; the pile is relaxed before it settles and settles
  at a creep, so nothing pops out of the surface; the grains are 4 % smaller,
  since a random pile jams looser than a lattice, which keeps the radius and
  the books; and the skin's silhouette is cut and feathered by a coverage
  field, which takes the staircase of lit discs off the limb.
- **2026-08-26 — The film.** An ACES-style tone curve — deeper shadows, a
  clean roll-off at the hottest — the sun as a disk with a glare that the
  bodies occlude, a light vignette, and FXAA. The knobs live in
  `__impact.look`.
- **2026-08-26 — Lit by the magma.** The planet and the second body light
  what is near them with the glow of their own surface: the arm and the
  disk get their planet-facing sides in orange, a moonlet is lit from
  below, the planet's cold far side stays dark, and the bodies shadow each
  other as balls — the first cut lit the crust spalled off the impactor's
  far side through the impactor, a glint along its rim.
- **2026-08-26 — Heat.** The heat the contacts make stays in the material
  and spreads by contact; every particle has a temperature and the rock glows
  by it — the planet a magma ocean at 3000 K a day after the canonical
  impact, the far side cold, the sparks off the contact white — and the
  readout says the mean. Bloom on what is brighter than white. On the way:
  the books were booking a barely-loaded contact's spring work as heat with
  either sign; the balance goes from −2.8 % to under a percent.
- **2026-08-26 — Faster.** A step at 131k from 2.5 ms to 1.4, and 4× runs at
  30 fps instead of 19: empty mesh blocks skipped, the mesh every eighth
  step, the particles kept in spatial order, the analysis read back without
  waiting, the spring let go after the splash. And the mesh deposit was
  losing 2 % of the mass to half-float rounding; it blends in full floats.
- **2026-08-26 — Dust, gone.** The points that rode on the particles never
  read as anything but noise; the skin is the body.
- **2026-08-26 — The disk binds.** Moonlets came apart into puffs: a cell
  of the gravity mesh is five particles wide and a moonlet is a cell or two.
  The loose material now gets its gravity corrected pairwise, P³M-style, and
  the disk collects into moonlets that stay; a moon line says what Moon the
  disk would make.
- **2026-08-26 — The books.** The readout keeps momentum, angular momentum
  and energy, and they caught the gravity mesh braking a spinning planet by
  lagging four steps behind it; the mesh now pulls as one impulse where it
  is measured, and cell on cell at centres of mass, and L holds to 0.01 %.
- **2026-08-26 — Spin.** Both bodies arrive turning about their axes, with
  eight-hour days by default and sliders from none to a 2.6-hour Earth, each
  cut beforehand as the Maclaurin spheroid its spin calls for. Dust is off by
  default.
- **2026-08-25 — Cores.** Both bodies get an iron core, a mantle and a crust,
  with density as mass; the readout says what each piece is made of and how
  long the planet's day is.
- **2026-08-25 — A brighter sky.** The page gets the same real catalogue sky
  the main animation has, instead of a hash.
- **2026-08-25 — Impact.** Two planets of real mass collide under their own
  gravity, on the GPU, from the canonical Moon-forming impact to a hit-and-run.
  A readout says what stays, what orbits, and what escapes.

The page began as a second page of [stardust](https://github.com/Gaploid/stardust)
and moved into this repository on 2026-08-26, with its history.

## License

MIT — see [LICENSE](LICENSE).
