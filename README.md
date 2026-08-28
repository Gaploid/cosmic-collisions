# Cosmic Collisions

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
exposure, glow, shading and stars do not.

Drag rotates · wheel or pinch zooms · Space pauses · R restarts · F follows the
largest body. On a phone it opens at 33k particles and gives back pixels — never
physics — if the frames start to cost too much.

Not SPH — no shocks, no vaporization — but the deformation, the tidal arm, the
disk and the re-accretion are all there.

## Chicxulub

**The crater.** A cylinder of the Yucatán platform — three kilometres of
carbonate over crystalline basement, its wall and floor held still because the
rest of the world is not in the box — and a carbonaceous asteroid arriving at
60° from the north-east at 20 km/s. The ground erupts, the curtain goes up as an
inverted cone, and the transient bowl opens in about eighty seconds before
collapsing into the wider, shallower crater that is there today. Presets run
from a 1 km rock to a 30 km one; the readout gives the energy, the crater dug
beside the crater the scaling asks for, what was thrown past the rim, the shock
melt and the seismic magnitude.

**The planet.** The Earth the giant impact is made of — a hundred thousand
grains under their own gravity, on the same engine — and a rock thrown at it.
This is the view where the surface breaks, and the one that has to be honest
about why it mostly cannot: at 131k grains Earth's grain is 218 km across, and
Chicxulub's rock was 14. The rock is always built at its true mass and drawn as
however many grains that is worth — one, when it is worth less than one — so the
*chicxulub* button does exactly what a 14 km rock does to a planet, which is
nothing anyone can see, and says so. The surface starts to go a few hundred
kilometres up: *1000 km* is a white wound and a spray of ejecta into orbit,
*2000 km* a basin the size of a continent, and above that it hands over to the
giant-impact page, whose smallest rock is 0.02 M⊕.

**The first day.** The whole planet, and the same impact seen from far enough
away that the crater is a dot. Nothing here deforms, and a view that promised
otherwise would be lying: the rock is a 1.6-billionth of Earth's mass. What
flies is what came out of the hole — a plume that leaves faster than the
atmosphere can hold it, arcs over half a world, and is coming down everywhere
within two hours; that, not the crater, is what ended the Cretaceous. Earth is a
shell of frozen particles drawn as a globe with a graticule instead of
coastlines, and the motes are tracers rather than rocks: nothing here is to
scale except the trajectories, which are exact.

**Where the numbers come from, and where they do not.** A contact model has no
shock and no vapour, so it cannot be asked what a 20 km/s impact does in its
first second; what comes out of that second is given to it instead — an
excavation flow radial from a buried point source, with Housen & Holsapple's
speeds and Maxwell's Z-model directions, going to nothing at the transient
radius π-group scaling gives, so the hole is the right size by construction.
Everything after is the sim's own and is the part worth watching, and the
readout prints the crater it dug beside the one the scaling asked for — across
the five presets they agree to between 0.7 and 1.2. The globe's plume is
anchored to the 25 trillion tonnes Chicxulub threw clear, its motes are not
slowed by the air so their energy is booked as delivered to the atmosphere, and
the sulfur is not from the run at all: that needs a hydrocode, so the readout
quotes the published range and says whose.

The numbers it stands on: Collins, Melosh & Marcus 2005 (*Meteoritics &
Planetary Science* **40**, 817) for the crater scaling and the seismic
magnitude; Housen & Holsapple 2011 for the ejecta velocities; Melosh 1989 §5.4
for the Z-model; Collins et al. 2020 (*Nature Communications* **11**, 1480) for
the 45–60° trajectory from the north-east; Gulick et al. 2013 and IODP-ICDP
Expedition 364 for the target and the peak ring; Fischer-Gödde et al. 2024
(*Science* **385**, 752) for the carbonaceous impactor; Artemieva & Morgan 2017
and Gulick et al. 2025 for the two ends of the sulfur estimate.

## Tech

A page per scenario over a shared engine in `src/`, wired with plain script
tags — no dependencies, no build step, and a page still opens from disk. It is
WebGL 2 with no compute shaders to lean on, so the hard parts are tricks:
contacts from a hashed grid filled by depth-peeling, gravity from a 64³ particle
mesh with the loose material corrected pairwise against it, P³M-style, so
moonlets bind instead of smearing. Its bodies are onions of Fibonacci-spiral
shells, relaxed and then crept into equilibrium so that nothing pops out of the
surface; symplectic Euler, Morton order, and books on momentum and energy that
caught most of what was wrong. The picture is screen-space fluid rendering —
impostors, a bilateral blur that melts them into a skin, a coverage cut that
takes the beads off the limb — with a surface drawn in each grain's own
coordinates so it rides the material, and hot rock glowing by its temperature
and lighting everything else. GGX, ACES and FXAA; the knobs are in
`__impact.look`.

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

- **2026-08-28 — A longer run-up, and a loading line.** The bodies set off
  3.7 R⊕ short of contact instead of 2.4, so the approach runs some seven
  seconds at 1× where it was under five — long enough to see who is coming from
  where. And the page says what it is doing while the thread is away: a line
  mid-screen, building or settling, gone when the approach begins.
- **2026-08-27 — A surface.** The planet was a blue ball with the lumps the
  impostors left in it; it wears a surface now, textured in the coordinates each
  grain carries from where it sat in its body, so the relief turns with the
  body, stretches with the arm and goes out with the ejecta. A round body's skin
  leans on the ball it is, which took the torn limb off the close view, and the
  bodies light each other by the inverse square — for 0.8 ms more at the default
  view and 2.4 close in, on an RTX 4070.
- **2026-08-27 — The planet.** Asked for the Earth to be breakable, and it is:
  the engine that runs Theia moved into `src/nbody.js`, and Chicxulub's page got
  a third view that builds Earth out of it and throws a rock. The honest part is
  the rock's size — a 14 km stone is a six-thousandth of one grain, so it is
  drawn as the one grain it is worth, does nothing, and the readout says so.
- **2026-08-27 — The first day.** The crater is the small half of Chicxulub;
  the other half is what came out of it, and that is a whole-planet story. So
  the scenario has a second view — Earth as a shell of frozen particles drawn as
  a globe, and fifty thousand tracers carrying the plume over the horizon inside
  a quarter of an hour and back down everywhere within two.
- **2026-08-27 — Chicxulub.** The other end of the scale from a planet: an
  asteroid six thousand times lighter than one particle of the giant impact,
  hitting ground that is a patch rather than a world — constant gravity, seconds
  instead of hours, a box cut to the crater. The impactor is carried in rigid
  and consumed at contact, handing the ground an excavation flow; everything
  after is the sim's own, and the engine they now share moved to `src/`.
- **2026-08-27 — A readout that holds still.** The report was a stack of
  sentences whose rows appeared and vanished with the run, so following one
  figure meant finding it again each time. It is a table now — every row always
  present, name, number and note each in a column of its own, the numbers
  right-aligned on their decimal points, the box a fixed width.
- **2026-08-27 — The phone's own readout.** A phone has no room for an audit:
  the report gives the outcome and the provenance of that figure, and the books
  stay on the wide screen that has the room to argue. The clock and the run's
  numbers share one line across the foot, and the corner carries a link to the
  source.
- **2026-08-26 — A phone can hold this.** The run was built for a desk; a phone
  takes the same collision at a quarter of the particles — 33k still splashes,
  still throws a disk, still gathers a moon — and the picture falls to 85 % and
  then 72 % of a side if the frames stop coming. The canvas and the readouts sit
  inside the notch and the home bar, and follow moved onto the `f` key.
- **2026-08-26 — A shorter panel.** The advanced panel lost its two spin
  sliders — a spin is a property of the rock, like its density — and says the
  rest in fewer words, with a rule marking where the settings that restart the
  run end.
- **2026-08-26 — Skin.** The bodies are built as onions of Fibonacci shells
  instead of a lattice cut to a sphere, so the concentric rings the crust wore
  are gone, and the pile is relaxed before it settles so that nothing pops out
  of the surface. The skin's silhouette is cut and feathered by a coverage
  field, which takes the staircase of lit discs off the limb.
- **2026-08-26 — The film.** An ACES-style tone curve — deeper shadows, a clean
  roll-off at the hottest — the sun as a disk with a glare that the bodies
  occlude, a light vignette, and FXAA. The knobs live in `__impact.look`.
- **2026-08-26 — Lit by the magma.** The planet and the second body light what
  is near them with the glow of their own surface: the arm and the disk get
  their planet-facing sides in orange, a moonlet is lit from below, the planet's
  cold far side stays dark, and the bodies shadow each other as balls.
- **2026-08-26 — Heat.** The heat the contacts make stays in the material and
  spreads by contact; every particle has a temperature and the rock glows by
  it — a magma ocean at 3000 K a day after the canonical impact, the far side
  cold. On the way: the books were booking a barely-loaded contact's spring work
  as heat with either sign, and the balance goes from −2.8 % to under a percent.
- **2026-08-26 — Faster.** A step at 131k from 2.5 ms to 1.4, and 4× runs at
  30 fps instead of 19: empty mesh blocks skipped, the mesh every eighth step,
  the particles in spatial order, the analysis read back without waiting, the
  spring let go after the splash. And the mesh deposit was losing 2 % of the
  mass to half-float rounding; it blends in full floats now.
- **2026-08-26 — Dust, gone.** The points that rode on the particles never read
  as anything but noise; the skin is the body.
- **2026-08-26 — The disk binds.** Moonlets came apart into puffs, a cell of the
  gravity mesh being five particles wide and a moonlet a cell or two. The loose
  material now gets its gravity corrected pairwise, P³M-style, the disk collects
  into moonlets that stay, and a moon line says what Moon it would make.
- **2026-08-26 — The books.** The readout keeps momentum, angular momentum and
  energy, and they caught the gravity mesh braking a spinning planet by lagging
  four steps behind it. The mesh now pulls as one impulse where it is measured,
  and cell on cell at centres of mass, and L holds to 0.01 %.
- **2026-08-26 — Spin.** Both bodies arrive turning about their axes, with
  eight-hour days by default and sliders from none to a 2.6-hour Earth, each cut
  beforehand as the Maclaurin spheroid its spin calls for.
- **2026-08-25 — Cores.** Both bodies get an iron core, a mantle and a crust,
  with density as mass; the readout says what each piece is made of and how long
  the planet's day is.
- **2026-08-25 — A brighter sky.** The page gets the same real catalogue sky the
  main animation has, instead of a hash.
- **2026-08-25 — Impact.** Two planets of real mass collide under their own
  gravity, on the GPU, from the canonical Moon-forming impact to a hit-and-run.
  A readout says what stays, what orbits, and what escapes.

The page began as a second page of [stardust](https://github.com/Gaploid/stardust)
and moved into this repository on 2026-08-26, with its history.

## Analytics

This site uses Google Analytics to understand basic usage.

## License

MIT — see [LICENSE](LICENSE).
