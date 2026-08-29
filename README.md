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

- **2026-08-29 — The melt.** A magma ocean was a flat yellow disc: its
  convection cells faded on a coherent surface and went out past 6000 K.
  Now the cells run over the whole melt, give way to a photosphere's
  granulation where it is hotter, run whiter in the upwelling and redder
  in the lanes, and the melt darkens toward its limb as any glowing ball
  does — so the disc is a ball.
- **2026-08-29 — Tone and grain.** The surfaces were clay: one matte tone
  shaded softly. Now the highlands stand paler and the lowlands deeper, a
  cratered crust wears maria — the low plains its old lava flooded, dark,
  smooth and with fewer craters, being younger — and the regolith has a
  grain, a speckle that fades out as its period nears a pixel so the far
  view does not crawl. 0.2 ms more on the close view.
- **2026-08-29 — Craters and seas.** The craters were dimples on a golf
  ball, two sizes of them; now they are craters — a flat floor, a wall up to
  a narrow crest, an ejecta blanket, a central peak in the biggest, rays
  off a few fresh ones — in four octaves so that there are four times as
  many at half the size. Each material says what surface it wears (bare
  rock, a cratered crust, a crust with seas), and Earth's crust has seas:
  water below a level, flat and glossy with the sun's glint on it, the
  land a tenth of the surface and dark basalt — no continents yet, a young
  crust between magma oceans — and the seas boiled off as the crust warms.
  0.5 ms more on the close view.
- **2026-08-29 — The air goes.** The shell on a hit body was a neon ring:
  rock vapour puffed round a ball the analysis had drawn round the wrong
  thing — the group's density edge about its centre of mass, which an
  attached impactor or a curtain of ejecta pulls most of a radius off. Now the
  analysis finds a body's centre from the material it is mostly made of
  and its edge about that centre, and the atmosphere does what a giant
  impact does to one: over the eight minutes after contact loses the share
  the ground motion throws off — Schlichting, Sari & Yalinewich's
  0.4x + 1.4x² − 0.8x³ of x = (v/v_esc)(m/M): a tenth for Theia, a third
  for a hit & run, all of it for twins and the shatter — and every bit of
  it over the hot ground; none of it comes back.
- **2026-08-29 — The air of that world.** The blue limb was today's sky, and
  today's sky is nitrogen and two billion years of oxygen away from the
  giant impact: a proto-Earth wears the steam its magma ocean boils off —
  water and carbon dioxide at tens to hundreds of bars, white with cloud
  rather than blue with Rayleigh. Theia has one now too, since a Mars-sized
  body degasses one and holds it: a lighter planet keeps a shorter column
  and keeps it further out, so hers is half as bright and twice as tall.
- **2026-08-28 — The cinema.** The picture was correct and flat: balls with
  no air round them, ejecta as confetti, a melt as one yellow. Now the
  bodies wear an atmosphere — thin and blue while cold, a glowing vapour
  over the heat once hit — the loose hot grains fly as comets with tails,
  the planet shadows its disk, the melt convects, and the film has a lens:
  light shafts off a hidden sun, streak, ghosts, shimmer, aberration and
  grain, with thirty thousand faint stars behind the catalogue and a camera
  that drifts until it is touched. The picture keys the ball, the light and
  the shell to a body's own core rather than its group's centre of mass,
  which the arm pulled a seventh of a radius off, and eases each report's
  jump. All of it for 0.3 ms a frame.
- **2026-08-28 — The Moon stays.** The Moon the theia run makes — 1.3 M☾ at
  3.5–5 R⊕, outside the Roche limit, where the real one formed — came apart
  after a hundred hours: the mesh's far field pushed the system 18 m/s, a
  radius in that time, and the orbit reached the edge of the box, where the
  pairwise pass subtracted a mesh force that was not there; and the contact
  grid's wrap laid the moon's cells over the planet's limb once an orbit,
  filling them past their seats. The far field is summed block to block with
  the tidal tensor now, a pair with a side off the mesh gets the whole of
  Newton, and the wrap's images are skewed off the plane: at 100 h the drift is
  0.7 m/s and the Moon is at a = 4.6 R⊕, e = 0.12.
- **2026-08-28 — Zero at first touch.** The clock counted from the start line,
  so the bodies met at T+ 1h. It counts down to contact now — the rigid
  flight is run once at build to learn how long it takes — and up from
  there, as Chicxulub's does.
- **2026-08-28 — Twice the step.** A step at 131k from 2.1 ms to 1.1 in
  sequence, at 262k from 3.7 to 1.9; 4× runs at 41–48 fps where it ran at
  19–25, and 2× at 262k at 50 where it ran at 26. The contact cells' eight seat
  textures became two, each seat carrying where its particle sat so most
  candidates are let go unfetched; the pairwise pass's tables moved from
  uniform arrays, which serve a divergent index one thread at a time, into a
  texture, and its sum into four slices; the mesh deposit takes the particles
  in a scrambled order, so the ROP is not fed a cell's blends in a row. The
  seats come out the same to the bit; the deposit sums in another order, which
  moves the books at the fifth digit.
- **2026-08-28 — The light on the second body.** A hot body's light shaded
  the skin by each grain's own normal, so a lit face came out as a honeycomb of
  crescents that slid over it as the camera turned; it goes by the smoothed
  skin's normal now, the grain's only along a silhouette. And a grain that
  fell back onto a skin is drawn as part of that skin rather than as a raw ball
  on it, whose pixel-snapped edge the blur smeared into streaks that flickered.
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
